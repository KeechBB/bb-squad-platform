/**
 * Кейсы площадки: Сад Фракции (B$) и Урожай BlackBerry (BBC).
 * Шансы ∝ 1/цене; Эмка / Призрак < 1%; ~50% пусто.
 */
import { addBgQty } from "@/lib/profileBgStock";
import { addPatchQty } from "@/lib/nickPatchStock";
import { writeNickPatchesCache } from "@/lib/nickPatchesCache";
import { marketPatchMeta, patchDefaultCurrency } from "@/lib/bbCoinPatchPrices";
import { marketBgMeta } from "@/lib/bbCoinBgPrices";
import {
  isMarketSellOnlyPatch,
  MARKET_PATCH_ORDER,
} from "@/lib/marketPatchIds";
import { MARKET_BG_ORDER } from "@/lib/marketBgIds";
import { resolveListingPrice } from "@/lib/marketListingPrices";
import { chargeMarketBuy, hasInfiniteMarketWallet } from "@/lib/marketCharge";
import { creditBbCoins } from "@/lib/bbCoins";
import { creditPersonalBd } from "@/lib/marketFactionPay";
import { personLabel, writeActionLog } from "@/lib/actionLog";
import { prisma } from "@/lib/prisma";
import {
  PROFILE_PATCH_OPTIONS,
  type ProfilePatchId,
} from "@/lib/profilePatches";
import type { MarketCurrency, ResolvedListingPrice } from "@/lib/marketListingPrices";
import { BD_MARK, BD_NAME } from "@/lib/blueberryDollar";

export type MarketCaseId = "faction-sad" | "bbc-urozhay";

export type CaseLootKind = "patch" | "bg" | "empty" | "currency";

export type CaseLootEntry = {
  key: string;
  kind: CaseLootKind;
  itemId: string | null;
  title: string;
  image: string | null;
  /** Цена купить (для весов редкости). */
  price: number;
  /** Текущая цена продажи на площадке / номинал валютного дропа. */
  sellPrice: number;
  /** Валюта продажи / дропа: BBC или BD ($). */
  sellCurrency: MarketCurrency | null;
  /** Для currency — сколько зачислить. */
  amount?: number;
  chancePct: number;
};

export type MarketCaseDef = {
  id: MarketCaseId;
  name: string;
  blurb: string;
  currency: MarketCurrency;
  currencyLabel: string;
  price: number;
  image: string;
};

/** Эмка (M4 BP) и Оранжевый призрак — ультра-редкие. */
export const CASE_ULTRA_ITEM_IDS = new Set([
  "bp-l15-keech",
  "creator-orange-phantom",
]);

/** Легендарки только в кейсах (не в магазине). */
export const CASE_LEGENDARY_PATCH_ID =
  "creator-svd-faction-lord" as const satisfies ProfilePatchId;
export const CASE_GP_PATCH_ID =
  "creator-gp-drum-berry-lore" as const satisfies ProfilePatchId;
/** 0.01% базовый шанс. */
export const CASE_LEGENDARY_SHARE = 0.0001;
/** Гарантия на N-й крутке кейса (pity) — только СВД. */
export const CASE_LEGENDARY_PITY = 100;
/** Оценка продажи для ROI в логе (ещё не в магазине). */
export const CASE_LEGENDARY_SELL = 50_000;
export const CASE_GP_SELL = 40_000;

/** Валютные джекпоты (0.01%) — в кейсе своей валюты. */
export const CASE_CASH_BBC_ID = "cash-bbc-20000";
export const CASE_CASH_BBC_AMOUNT = 20_000;
export const CASE_CASH_BD_ID = "cash-bd-1000000";
export const CASE_CASH_BD_AMOUNT = 1_000_000;
export const CASE_JACKPOT_SHARE = 0.0001; // 0.01%

/**
 * Вместо «пусто»: мелкие суммы валюты кейса.
 * BBC: 50→50%, 100→30%, 200→15%. BD: 500→50%, 1000→30%, 2000→15%.
 * Остаток ~5% — скины/фоны (+ ультра/immortal/джекпот поверх).
 */
export const CASE_FILLER_BBC: { id: string; amount: number; chancePct: number }[] =
  [
    { id: "cash-bbc-50", amount: 50, chancePct: 50 },
    { id: "cash-bbc-100", amount: 100, chancePct: 30 },
    { id: "cash-bbc-200", amount: 200, chancePct: 15 },
  ];
export const CASE_FILLER_BD: { id: string; amount: number; chancePct: number }[] =
  [
    { id: "cash-bd-500", amount: 500, chancePct: 50 },
    { id: "cash-bd-1000", amount: 1000, chancePct: 30 },
    { id: "cash-bd-2000", amount: 2000, chancePct: 15 },
  ];

/** Жёсткий потолок на ультра (< 1%). */
export const ULTRA_MAX_SHARE = 0.009;

export const MARKET_CASES: MarketCaseDef[] = [
  {
    id: "faction-sad",
    name: "Жатва Черники · v1",
    blurb: "Серия I · фракционный ящик за Черничный доллар (казна)",
    currency: "BD",
    currencyLabel: `${BD_NAME} (${BD_MARK})`,
    price: 5000,
    image: "/market-cases/case-faction-sad.jpg",
  },
  {
    id: "bbc-urozhay",
    name: "Первый Плод · v1",
    blurb: "Серия I · общий ящик Сада за BB Coins",
    currency: "BBC",
    currencyLabel: "BBC",
    price: 500,
    image: "/market-cases/case-bbc-urozhay.jpg",
  },
];

export function getMarketCase(id: string): MarketCaseDef | null {
  return MARKET_CASES.find((c) => c.id === id) || null;
}

/** Кейсы открыты всем залогиненным; gate на API — requireMarketUser. */
export function canAccessMarketCases(
  steamId: string | null | undefined
): boolean {
  return Boolean(steamId && String(steamId).trim());
}

type RawItem = {
  key: string;
  kind: "patch" | "bg";
  itemId: string;
  title: string;
  image: string;
  price: number;
  sellPrice: number;
  sellCurrency: MarketCurrency;
};

async function loadCasePool(currency: MarketCurrency): Promise<RawItem[]> {
  const out: RawItem[] = [];
  for (const id of MARKET_PATCH_ORDER) {
    // Легендарки кейса — только через injectCaseSpecials (0.01%), не в общем пуле.
    if (isMarketSellOnlyPatch(id)) continue;
    const price = await resolveListingPrice("patch", id);
    // Фракционные нашивки всегда в кейсе казны, даже если листинг сдвинули.
    const cur = id.startsWith("bd-faction-")
      ? "BD"
      : price?.currency ?? patchDefaultCurrency(id);
    if (cur !== currency) continue;
    const meta = marketPatchMeta(id);
    out.push({
      key: `patch:${id}`,
      kind: "patch",
      itemId: id,
      title: meta.title,
      image: meta.image,
      price: price?.buy ?? meta.buy,
      sellPrice: price?.sell ?? meta.sell,
      sellCurrency: cur,
    });
  }
  for (const id of MARKET_BG_ORDER) {
    const price = await resolveListingPrice("bg", id);
    const isFactionBg = id.startsWith("bd-faction-");
    const cur = isFactionBg ? "BD" : price?.currency ?? "BBC";
    if (cur !== currency) continue;
    const meta = marketBgMeta(id);
    out.push({
      key: `bg:${id}`,
      kind: "bg",
      itemId: id,
      title: meta.title,
      image: meta.image,
      price: price?.buy ?? meta.buy,
      sellPrice: price?.sell ?? meta.sell,
      sellCurrency: cur,
    });
  }
  return out;
}

function fillerCashEntry(
  currency: MarketCurrency,
  id: string,
  amount: number,
  chancePct: number
): CaseLootEntry {
  const isBbc = currency === "BBC";
  return {
    key: `currency:${id}`,
    kind: "currency",
    itemId: id,
    title: isBbc
      ? `${amount.toLocaleString("ru-RU")} BBC`
      : `${amount.toLocaleString("ru-RU")} ${BD_MARK}`,
    image: isBbc
      ? "/market-cases/case-loot-bbc-20k.png"
      : "/market-cases/case-loot-bd-1m.png",
    price: amount,
    sellPrice: amount,
    sellCurrency: currency,
    amount,
    chancePct,
  };
}

/** Собрать таблицу шансов (сумма ≈ 100). Без пустых — мелочь валюты вместо них. */
export function buildLootChances(
  pool: RawItem[],
  currency: MarketCurrency
): CaseLootEntry[] {
  const fillers = currency === "BBC" ? CASE_FILLER_BBC : CASE_FILLER_BD;
  const fillerPctSum = fillers.reduce((a, f) => a + f.chancePct, 0);
  const fillerShare = fillerPctSum / 100;

  const entries: CaseLootEntry[] = fillers.map((f) =>
    fillerCashEntry(currency, f.id, f.amount, f.chancePct)
  );

  if (pool.length === 0) {
    // Только валюта — дотянуть до 100 на самый частый филлер.
    const sum = entries.reduce((a, e) => a + e.chancePct, 0);
    if (entries[0] && Math.abs(sum - 100) > 0.05) {
      entries[0].chancePct =
        Math.round((entries[0].chancePct + (100 - sum)) * 100) / 100;
    }
    return entries.sort((a, b) => b.chancePct - a.chancePct);
  }

  const ultra = pool.filter((p) => CASE_ULTRA_ITEM_IDS.has(p.itemId));
  const normal = pool.filter((p) => !CASE_ULTRA_ITEM_IDS.has(p.itemId));

  const ultraEach = Math.min(
    ULTRA_MAX_SHARE,
    ultra.length ? (1 - fillerShare) / (ultra.length + 4) : 0
  );
  const ultraTotal = ultraEach * ultra.length;
  const itemsShare = Math.max(0.01, 1 - fillerShare - ultraTotal);

  const invWeights = normal.map((p) => 1 / Math.max(1, p.price));
  const invSum = invWeights.reduce((a, b) => a + b, 0) || 1;

  for (const u of ultra) {
    entries.push({
      key: u.key,
      kind: u.kind,
      itemId: u.itemId,
      title: u.title,
      image: u.image,
      price: u.price,
      sellPrice: u.sellPrice,
      sellCurrency: u.sellCurrency,
      chancePct: Math.round(ultraEach * 10000) / 100,
    });
  }

  for (let i = 0; i < normal.length; i++) {
    const p = normal[i];
    const share = itemsShare * (invWeights[i] / invSum);
    entries.push({
      key: p.key,
      kind: p.kind,
      itemId: p.itemId,
      title: p.title,
      image: p.image,
      price: p.price,
      sellPrice: p.sellPrice,
      sellCurrency: p.sellCurrency,
      chancePct: Math.round(share * 10000) / 100,
    });
  }

  // Нормализация до 100 — на самый частый филлер (50 / 500).
  const sum = entries.reduce((a, e) => a + e.chancePct, 0);
  if (sum > 0 && Math.abs(sum - 100) > 0.05 && entries[0]) {
    entries[0].chancePct =
      Math.round((entries[0].chancePct + (100 - sum)) * 100) / 100;
  }

  return entries.sort((a, b) => b.chancePct - a.chancePct);
}

function caseExclusivePatchEntry(
  patchId: ProfilePatchId,
  sellPrice: number,
  fallbackTitle: string,
  fallbackFile: string
): CaseLootEntry {
  const opt = PROFILE_PATCH_OPTIONS.find((o) => o.id === patchId);
  const title = opt?.label || fallbackTitle;
  const file = opt?.file || fallbackFile;
  return {
    key: `patch:${patchId}`,
    kind: "patch",
    itemId: patchId,
    title,
    image: `/bp-assets/${file}`,
    price: sellPrice,
    sellPrice,
    sellCurrency: "BBC",
    chancePct: Math.round(CASE_LEGENDARY_SHARE * 10000) / 100,
  };
}

function legendaryLootEntry(): CaseLootEntry {
  return caseExclusivePatchEntry(
    CASE_LEGENDARY_PATCH_ID,
    CASE_LEGENDARY_SELL,
    "СВД «Повелитель фракций»",
    "svd-faction-lord-v3.png"
  );
}

function gpDrumLootEntry(): CaseLootEntry {
  return caseExclusivePatchEntry(
    CASE_GP_PATCH_ID,
    CASE_GP_SELL,
    "РГ-6 «Ягодный барабан»",
    "gp-drum-berry-lore-v2.png"
  );
}

function cashBbcLootEntry(): CaseLootEntry {
  const chancePct = Math.round(CASE_JACKPOT_SHARE * 10000) / 100;
  return {
    key: `currency:${CASE_CASH_BBC_ID}`,
    kind: "currency",
    itemId: CASE_CASH_BBC_ID,
    title: `${CASE_CASH_BBC_AMOUNT.toLocaleString("ru-RU")} BBC`,
    image: "/market-cases/case-loot-bbc-20k.png",
    price: CASE_CASH_BBC_AMOUNT,
    sellPrice: CASE_CASH_BBC_AMOUNT,
    sellCurrency: "BBC",
    amount: CASE_CASH_BBC_AMOUNT,
    chancePct,
  };
}

function cashBdLootEntry(): CaseLootEntry {
  const chancePct = Math.round(CASE_JACKPOT_SHARE * 10000) / 100;
  return {
    key: `currency:${CASE_CASH_BD_ID}`,
    kind: "currency",
    itemId: CASE_CASH_BD_ID,
    title: `${CASE_CASH_BD_AMOUNT.toLocaleString("ru-RU")} ${BD_MARK}`,
    image: "/market-cases/case-loot-bd-1m.png",
    price: CASE_CASH_BD_AMOUNT,
    sellPrice: CASE_CASH_BD_AMOUNT,
    sellCurrency: "BD",
    amount: CASE_CASH_BD_AMOUNT,
    chancePct,
  };
}

/** Легендарки в оба кейса; валютный джекпот — только в кейсе своей валюты. */
export function injectCaseSpecials(
  entries: CaseLootEntry[],
  currency: MarketCurrency
): CaseLootEntry[] {
  const specials = [
    legendaryLootEntry(),
    gpDrumLootEntry(),
    ...(currency === "BBC" ? [cashBbcLootEntry()] : [cashBdLootEntry()]),
  ];
  const skip = new Set(specials.map((s) => s.itemId));
  const without = entries.filter((e) => !e.itemId || !skip.has(e.itemId));
  const take = specials.reduce((a, s) => a + s.chancePct, 0);
  // Списываем с самого частого филлера (50 BBC / 500 $), не с скинов.
  const fillerIds = new Set(
    (currency === "BBC" ? CASE_FILLER_BBC : CASE_FILLER_BD).map((f) => f.id)
  );
  const pad = without
    .filter((e) => e.kind === "currency" && e.itemId && fillerIds.has(e.itemId))
    .sort((a, b) => b.chancePct - a.chancePct)[0];
  if (pad) {
    pad.chancePct = Math.round((pad.chancePct - take) * 100) / 100;
    if (pad.chancePct < 0.01) pad.chancePct = 0.01;
  }
  const next = [...without, ...specials];
  const sum = next.reduce((a, e) => a + e.chancePct, 0);
  if (pad && Math.abs(sum - 100) > 0.05) {
    pad.chancePct = Math.round((pad.chancePct + (100 - sum)) * 100) / 100;
  }
  return next.sort((a, b) => b.chancePct - a.chancePct);
}

export async function getCaseLootTable(caseId: MarketCaseId): Promise<CaseLootEntry[]> {
  const def = getMarketCase(caseId);
  if (!def) return [];
  const pool = await loadCasePool(def.currency);
  return injectCaseSpecials(buildLootChances(pool, def.currency), def.currency);
}

async function countCaseOpens(userId: string, caseId: MarketCaseId): Promise<number> {
  const rows = await prisma.actionLog.findMany({
    where: {
      category: "cases",
      action: "case_open",
      actorId: userId,
    },
    select: { meta: true },
    take: 5000,
    orderBy: { createdAt: "desc" },
  });
  let n = 0;
  for (const r of rows) {
    const meta =
      r.meta && typeof r.meta === "object" && !Array.isArray(r.meta)
        ? (r.meta as Record<string, unknown>)
        : null;
    if (meta?.caseId === caseId) n += 1;
  }
  return n;
}

function pickWeighted(entries: CaseLootEntry[], rnd = Math.random()): CaseLootEntry {
  const total = entries.reduce((a, e) => a + e.chancePct, 0);
  let r = rnd * total;
  for (const e of entries) {
    r -= e.chancePct;
    if (r <= 0) return e;
  }
  return entries[entries.length - 1];
}

/**
 * Лента для анимации CS-рулетки (сервер отдаёт seed-результат).
 * Веса ленты ≈ визуальное разнообразие оружия; валюту чуть подсвечиваем,
 * но без «стены» одинаковых баксов. Реальный шанс дропа не меняется.
 */
export function buildRouletteStrip(
  entries: CaseLootEntry[],
  winner: CaseLootEntry,
  opts?: { length?: number; landIndex?: number }
): CaseLootEntry[] {
  const length = opts?.length ?? 64;
  const landIndex = opts?.landIndex ?? 52;

  const weighted: CaseLootEntry[] = [];
  for (const e of entries) {
    let n = Math.max(1, Math.round(e.chancePct));
    if (e.kind === "currency") {
      // Филлеры (50/100/…) уже имеют большие % — на ленте по шансу.
      n = Math.max(1, Math.round(e.chancePct));
    } else if (
      e.itemId === CASE_LEGENDARY_PATCH_ID ||
      e.itemId === CASE_GP_PATCH_ID
    ) {
      n = Math.max(3, n);
    }
    for (let i = 0; i < n; i++) weighted.push(e);
  }
  if (!weighted.length) weighted.push(entries[0]);

  const strip: CaseLootEntry[] = [];
  for (let i = 0; i < length; i++) {
    if (i === landIndex) {
      strip.push(winner);
      continue;
    }
    strip.push(weighted[Math.floor(Math.random() * weighted.length)]);
  }
  return strip;
}

export async function openMarketCase(opts: {
  caseId: MarketCaseId;
  userId: string;
  steamId: string;
}): Promise<
  | {
      ok: true;
      caseId: MarketCaseId;
      currency: MarketCurrency;
      balance: number;
      result: CaseLootEntry;
      strip: CaseLootEntry[];
      landIndex: number;
    }
  | { ok: false; error: string }
> {
  if (!canAccessMarketCases(opts.steamId)) {
    return { ok: false, error: "wip" };
  }
  const def = getMarketCase(opts.caseId);
  if (!def) return { ok: false, error: "case" };

  const table = await getCaseLootTable(def.id);
  if (!table.length) return { ok: false, error: "empty_pool" };

  const price: ResolvedListingPrice = {
    catalog: "patch",
    itemId: `case:${def.id}`,
    currency: def.currency,
    buy: def.price,
    sell: 0,
    buyBase: def.price,
    sellBase: 0,
    deal: null,
  };

  const charged = await chargeMarketBuy({
    userId: opts.userId,
    steamId: opts.steamId,
    price,
    kind: "case_open",
    noteItem: `кейс «${def.name}»`,
  });
  if (!charged.ok) return charged;

  const opensBefore = await countCaseOpens(opts.userId, def.id);
  const pityHit =
    CASE_LEGENDARY_PITY > 0 &&
    (opensBefore + 1) % CASE_LEGENDARY_PITY === 0;
  const legendary = table.find((e) => e.itemId === CASE_LEGENDARY_PATCH_ID);
  const result =
    pityHit && legendary ? legendary : pickWeighted(table);
  const landIndex = 52;
  const strip = buildRouletteStrip(table, result, { length: 64, landIndex });

  if (result.kind === "patch" && result.itemId) {
    await addPatchQty(opts.userId, result.itemId, 1);
    await writeNickPatchesCache().catch(() => null);
  } else if (result.kind === "bg" && result.itemId) {
    await addBgQty(opts.userId, result.itemId, 1);
  } else if (result.kind === "currency") {
    const amt = Math.max(0, Math.trunc(result.amount || result.sellPrice || 0));
    if (amt > 0 && result.sellCurrency === "BBC") {
      await creditBbCoins({
        userId: opts.userId,
        amount: amt,
        kind: "case_drop",
        ref: `${def.id}:${result.itemId || "bbc"}:${Date.now()}`,
        note: `Дроп из кейса «${def.name}»: +${amt.toLocaleString("ru-RU")} BBC`,
      });
    } else if (amt > 0 && result.sellCurrency === "BD") {
      // Мелочь и джекпот B$ — на личный баланс открывшего.
      await creditPersonalBd({ userId: opts.userId, amount: amt });
    }
  }

  const actor = await prisma.user.findUnique({
    where: { id: opts.userId },
    select: { nick: true, steamName: true, steamId: true },
  });
  const nick = personLabel(actor || { steamId: opts.steamId });
  const spendLabel = `${def.price.toLocaleString("ru-RU")} ${
    def.currency === "BD" ? BD_MARK : "BBC"
  }`;
  const dropLabel =
    result.kind === "empty"
      ? "пусто"
      : result.kind === "currency"
        ? `${result.title} (зачисление)`
        : `${result.title}${
            result.sellPrice > 0
              ? ` (продажа ≈ ${result.sellPrice.toLocaleString("ru-RU")} ${
                  result.sellCurrency === "BD" ? BD_MARK : "BBC"
                })`
              : ""
          }`;
  await writeActionLog({
    category: "cases",
    action: "case_open",
    message: `${nick} открыл «${def.name}» (−${spendLabel}) → ${dropLabel}`,
    actorId: opts.userId,
    actorNick: nick,
    meta: {
      caseId: def.id,
      caseName: def.name,
      currency: def.currency,
      spent: def.price,
      dropKind: result.kind,
      dropItemId: result.itemId,
      dropTitle: result.kind === "empty" ? "Пусто" : result.title,
      dropImage: result.image,
      dropSell: result.sellPrice,
      dropSellCurrency: result.sellCurrency,
      chancePct: result.chancePct,
      infiniteWallet: hasInfiniteMarketWallet(opts.steamId),
      pity: pityHit && result.itemId === CASE_LEGENDARY_PATCH_ID,
      openIndex: opensBefore + 1,
    },
  });

  return {
    ok: true,
    caseId: def.id,
    currency: charged.currency,
    balance: charged.balance,
    result,
    strip,
    landIndex,
  };
}

export async function listMarketCasesPayload() {
  const cases = [];
  for (const def of MARKET_CASES) {
    const loot = await getCaseLootTable(def.id);
    cases.push({
      ...def,
      loot,
      nothingChancePct: 0,
    });
  }
  return cases;
}
