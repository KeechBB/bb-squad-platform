/**
 * Кейсы площадки: Сад Фракции (B$) и Урожай BlackBerry (BBC).
 * Шансы ∝ 1/цене; Эмка / Призрак < 1%; ~50% пусто.
 */
import { addBgQty } from "@/lib/profileBgStock";
import { addPatchQty } from "@/lib/nickPatchStock";
import { addFontQty } from "@/lib/nickStyleStock";
import { writeNickPatchesCache } from "@/lib/nickPatchesCache";
import { marketPatchMeta, patchDefaultCurrency } from "@/lib/bbCoinPatchPrices";
import { marketBgMeta } from "@/lib/bbCoinBgPrices";
import { marketFontMeta } from "@/lib/bbCoinFontPrices";
import {
  isMarketSellOnlyPatch,
  MARKET_PATCH_ORDER,
} from "@/lib/marketPatchIds";
import { MARKET_BG_ORDER } from "@/lib/marketBgIds";
import { MARKET_FONT_ORDER } from "@/lib/marketFontIds";
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

export type CaseLootKind = "patch" | "bg" | "empty" | "currency" | "font";

export type CaseLootEntry = {
  key: string;
  kind: CaseLootKind;
  itemId: string | null;
  title: string;
  image: string | null;
  /** Для шрифта — CSS-класс превью ника. */
  cssClass?: string | null;
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

/** Эмка (M4 BP) и Оранжевый призрак — фиксированный шанс каждый. */
export const CASE_ULTRA_ITEM_IDS = new Set([
  "bp-l15-keech",
  "creator-orange-phantom",
]);
/**
 * Суммарный шанс ультра (M4 + Призрак). Внутри — ∝ 1/цене:
 * дешевле → выше % (M4 4000 > Призрак 4500).
 */
export const CASE_ULTRA_TOTAL_SHARE = 0.038;
/** @deprecated равный шанс больше не используется */
export const CASE_ULTRA_SHARE = CASE_ULTRA_TOTAL_SHARE / 2;

/** Легендарки только в кейсах (не в магазине). */
export const CASE_LEGENDARY_PATCH_ID =
  "creator-svd-faction-lord" as const satisfies ProfilePatchId;
export const CASE_GP_PATCH_ID =
  "creator-gp-drum-berry-lore" as const satisfies ProfilePatchId;
export const CASE_RPG_PATCH_ID =
  "creator-rpg7-orchard-harvest" as const satisfies ProfilePatchId;
/** 0.01% базовый шанс. */
export const CASE_LEGENDARY_SHARE = 0.0001;
/** РПГ-7 «Урожайный удар» — только BD-кейс. */
export const CASE_RPG_SHARE = 0.0005; // 0.05%
/**
 * Шрифты ника — только BBC-кейс.
 * Дешевле → выше шанс: Алая жатва 2500 → 3.5%, Aurum 3000 → 3%.
 */
export const CASE_FONT_SHARE_BY_ID: Record<string, number> = {
  "hw2-violet-gothic": 0.035, // 3.5% · 2500 BBC
  "bp-l10-aurum-clean": 0.03, // 3% · 3000 BBC
};
/** Гарантия на N-й крутке кейса (pity) — только СВД. */
export const CASE_LEGENDARY_PITY = 100;
/** Оценка продажи для ROI в логе (ещё не в магазине). */
export const CASE_LEGENDARY_SELL = 50_000;
export const CASE_GP_SELL = 40_000;
export const CASE_RPG_SELL = 35_000;

/** Валютные джекпоты (0.01%) — в кейсе своей валюты. */
export const CASE_CASH_BBC_ID = "cash-bbc-200000";
export const CASE_CASH_BBC_AMOUNT = 200_000;
export const CASE_CASH_BD_ID = "cash-bd-1000000";
export const CASE_CASH_BD_AMOUNT = 1_000_000;
export const CASE_JACKPOT_SHARE = 0.0001; // 0.01%

/**
 * Вместо «пусто»: мелкие суммы валюты кейса (не стена баксов).
 * BBC: 100→18%, 200→10%, 500→7%. BD: 500→18%, 1000→10%, 2000→7%.
 * Остаток ~65% — скины/фоны (+ ультра/immortal/джекпот поверх).
 */
export const CASE_FILLER_BBC: { id: string; amount: number; chancePct: number }[] =
  [
    { id: "cash-bbc-100", amount: 100, chancePct: 18 },
    { id: "cash-bbc-200", amount: 200, chancePct: 10 },
    { id: "cash-bbc-500", amount: 500, chancePct: 7 },
  ];
export const CASE_FILLER_BD: { id: string; amount: number; chancePct: number }[] =
  [
    { id: "cash-bd-500", amount: 500, chancePct: 18 },
    { id: "cash-bd-1000", amount: 1000, chancePct: 10 },
    { id: "cash-bd-2000", amount: 2000, chancePct: 7 },
  ];

export const CASE_FILLER_IDS = new Set([
  ...CASE_FILLER_BBC.map((f) => f.id),
  ...CASE_FILLER_BD.map((f) => f.id),
]);

export function isCaseFillerCash(itemId: string | null | undefined): boolean {
  return Boolean(itemId && CASE_FILLER_IDS.has(itemId));
}

/** @deprecated используй CASE_ULTRA_SHARE */
export const ULTRA_MAX_SHARE = CASE_ULTRA_SHARE;

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
    price: 750,
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

  // Ультра: общий пул, доли ∝ 1/цене (дешевле — выше).
  const ultraWeights = ultra.map((p) => 1 / Math.max(1, p.price));
  const ultraWeightSum = ultraWeights.reduce((a, b) => a + b, 0) || 1;
  const ultraTotal = ultra.length ? CASE_ULTRA_TOTAL_SHARE : 0;
  const itemsShare = Math.max(0.01, 1 - fillerShare - ultraTotal);

  // Обычный пул: сильнее тянем к дешёвым (тыква дешевле цитруса → выше %).
  const invWeights = normal.map(
    (p) => 1 / Math.pow(Math.max(1, p.price), 1.35)
  );
  const invSum = invWeights.reduce((a, b) => a + b, 0) || 1;

  for (let i = 0; i < ultra.length; i++) {
    const u = ultra[i];
    const share = ultraTotal * (ultraWeights[i] / ultraWeightSum);
    entries.push({
      key: u.key,
      kind: u.kind,
      itemId: u.itemId,
      title: u.title,
      image: u.image,
      price: u.price,
      sellPrice: u.sellPrice,
      sellCurrency: u.sellCurrency,
      chancePct: Math.round(share * 10000) / 100,
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
  fallbackFile: string,
  opts?: {
    share?: number;
    sellCurrency?: MarketCurrency;
  }
): CaseLootEntry {
  const opt = PROFILE_PATCH_OPTIONS.find((o) => o.id === patchId);
  const title = opt?.label || fallbackTitle;
  const file = opt?.file || fallbackFile;
  const share = opts?.share ?? CASE_LEGENDARY_SHARE;
  return {
    key: `patch:${patchId}`,
    kind: "patch",
    itemId: patchId,
    title,
    image: `/bp-assets/${file}`,
    price: sellPrice,
    sellPrice,
    sellCurrency: opts?.sellCurrency ?? "BBC",
    chancePct: Math.round(share * 10000) / 100,
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

function rpgOrchardLootEntry(): CaseLootEntry {
  return caseExclusivePatchEntry(
    CASE_RPG_PATCH_ID,
    CASE_RPG_SELL,
    "РПГ-7 «Урожайный удар»",
    "rpg7-orchard-harvest-v2.png",
    { share: CASE_RPG_SHARE, sellCurrency: "BD" }
  );
}

function fontCaseLootEntries(): CaseLootEntry[] {
  return MARKET_FONT_ORDER.map((id) => {
    const meta = marketFontMeta(id);
    const share = CASE_FONT_SHARE_BY_ID[id] ?? 0.03;
    return {
      key: `font:${id}`,
      kind: "font" as const,
      itemId: id,
      title: meta.title,
      image: null,
      cssClass: meta.cssClass || null,
      price: meta.buy,
      sellPrice: meta.sell,
      sellCurrency: "BBC" as const,
      chancePct: Math.round(share * 10000) / 100,
    };
  });
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

/** Легендарки в оба кейса; РПГ и валютный джекпот — по валюте кейса. */
export function injectCaseSpecials(
  entries: CaseLootEntry[],
  currency: MarketCurrency
): CaseLootEntry[] {
  const specials = [
    legendaryLootEntry(),
    gpDrumLootEntry(),
    ...(currency === "BD" ? [rpgOrchardLootEntry()] : []),
    ...(currency === "BBC" ? [...fontCaseLootEntries(), cashBbcLootEntry()] : [cashBdLootEntry()]),
  ];
  const skip = new Set(specials.map((s) => s.itemId));
  const without = entries.filter((e) => !e.itemId || !skip.has(e.itemId));
  const take = specials.reduce((a, s) => a + s.chancePct, 0);
  // Списываем с самого частого филлера (100 BBC / 500 $), не с скинов.
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
 * На барабане — в основном скины/фоны; мелочь валюты редкими вспышками.
 * Реальный шанс дропа (chancePct) этим не меняется.
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
    let n: number;
    if (e.kind === "currency" && isCaseFillerCash(e.itemId)) {
      // Филлеры: максимум 1 слот на тир — без стены баксов на ленте.
      n = 1;
    } else if (e.kind === "currency") {
      n = 1; // джекпот
    } else if (
      e.itemId === CASE_LEGENDARY_PATCH_ID ||
      e.itemId === CASE_GP_PATCH_ID ||
      e.itemId === CASE_RPG_PATCH_ID
    ) {
      n = 5;
    } else {
      // Скины/фоны — основная масса барабана.
      n = Math.max(3, Math.round(Math.sqrt(Math.max(e.chancePct, 0.05)) * 10));
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
      paidFrom?: "treasury" | "personal" | "bbc" | "infinite";
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
  } else if (result.kind === "font" && result.itemId) {
    await addFontQty(opts.userId, result.itemId, 1);
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
      paidFrom: charged.paidFrom || null,
      pity: pityHit && result.itemId === CASE_LEGENDARY_PATCH_ID,
      openIndex: opensBefore + 1,
    },
  });

  // После дропа B$ на личный — отдать актуальный личный баланс.
  let balanceOut = charged.balance;
  if (
    result.kind === "currency" &&
    result.sellCurrency === "BD" &&
    charged.paidFrom === "personal"
  ) {
    const { getPersonalBdBalance } = await import("@/lib/marketFactionPay");
    balanceOut = await getPersonalBdBalance(opts.userId);
  } else if (
    result.kind === "currency" &&
    result.sellCurrency === "BBC" &&
    charged.currency === "BBC"
  ) {
    const { getBbCoinBalance } = await import("@/lib/bbCoins");
    balanceOut = await getBbCoinBalance(opts.userId);
  }

  return {
    ok: true,
    caseId: def.id,
    currency: charged.currency,
    balance: balanceOut,
    paidFrom: charged.paidFrom,
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
