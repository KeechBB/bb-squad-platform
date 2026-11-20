/**
 * Кейсы площадки: Жатва Черники (B$) и Первый Плод (BBC).
 * Правило для предметов: дороже цена → ниже шанс (∝ 1/цене) в обоих кейсах.
 * Мелочь-филлеры и джекпот валюты — отдельно.
 */
import { addBgQty } from "@/lib/profileBgStock";
import { addPatchQty } from "@/lib/nickPatchStock";
import { addFontQty } from "@/lib/nickStyleStock";
import { writeNickPatchesCache } from "@/lib/nickPatchesCache";
import { marketPatchMeta, patchDefaultCurrency } from "@/lib/bbCoinPatchPrices";
import { marketBgMeta } from "@/lib/bbCoinBgPrices";
import { marketFontMeta } from "@/lib/bbCoinFontPrices";
import { MARKET_PATCH_ORDER } from "@/lib/marketPatchIds";
import { MARKET_BG_ORDER } from "@/lib/marketBgIds";
import { MARKET_FONT_ORDER } from "@/lib/marketFontIds";
import { resolveListingPrice } from "@/lib/marketListingPrices";
import { chargeMarketBuy, hasInfiniteMarketWallet } from "@/lib/marketCharge";
import { creditBbCoins, getBbCoinBalance } from "@/lib/bbCoins";
import {
  addCaseJackpot,
  claimCaseJackpot,
  readCaseJackpots,
  restoreCaseJackpotIfFloor,
  returnCaseJackpotPayout,
  subtractCaseJackpot,
  type CaseJackpotPools,
} from "@/lib/caseJackpotPool";
import {
  creditFactionBd,
  creditPersonalBd,
  getFactionPayCtx,
  getPersonalBdBalance,
} from "@/lib/marketFactionPay";
import { personLabel, writeActionLog } from "@/lib/actionLog";
import { prisma } from "@/lib/prisma";
import type { ProfilePatchId } from "@/lib/profilePatches";
import type { MarketCurrency, ResolvedListingPrice } from "@/lib/marketListingPrices";
import { BD_MARK, BD_NAME } from "@/lib/blueberryDollar";
import {
  applyGroupBoost,
  caseBoostKindPrice,
  CASE_JACKPOT_CHANCE_PCT,
  CASE_RED_IMMORTAL_ADD,
  CASE_RED_RARE_ADD,
  CASE_SPIN_MS,
  type CaseBoostKind,
} from "@/lib/marketCaseBoost";
import { randomBytes } from "crypto";

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

/** Легендарки / эксклюзивы кейса (в пуле по цене продажи → шанс ∝ 1/цене). */
export const CASE_LEGENDARY_PATCH_ID =
  "creator-svd-faction-lord" as const satisfies ProfilePatchId;
export const CASE_GP_PATCH_ID =
  "creator-gp-drum-berry-lore" as const satisfies ProfilePatchId;
export const CASE_RPG_PATCH_ID =
  "creator-rpg7-orchard-harvest" as const satisfies ProfilePatchId;
/**
 * Pity Immortal (СВД / ГП): порог каждый раз рандом 80–150 открытий.
 * Следующая цель пишется в meta.pityNextAt лога открытия.
 */
export const CASE_PITY_GAP_MIN = 80;
export const CASE_PITY_GAP_MAX = 150;
/** @deprecated порог больше не фиксированный */
export const CASE_LEGENDARY_PITY = 100;
export const CASE_PITY_PATCH_IDS = [
  CASE_LEGENDARY_PATCH_ID,
  CASE_GP_PATCH_ID,
] as const;

function rollPityGap(): number {
  return (
    CASE_PITY_GAP_MIN +
    Math.floor(
      Math.random() * (CASE_PITY_GAP_MAX - CASE_PITY_GAP_MIN + 1)
    )
  );
}
/** Цена для весов шанса (продажа / оценка). */
export const CASE_LEGENDARY_SELL = 50_000;
export const CASE_GP_SELL = 40_000;
export const CASE_RPG_SELL = 35_000;
/** @deprecated больше нет отдельного ультра-пула */
export const CASE_ULTRA_ITEM_IDS = new Set([
  "bp-l15-keech",
  "creator-orange-phantom",
]);
export const CASE_ULTRA_SHARE = 0.019;
export const CASE_ULTRA_TOTAL_SHARE = 0.038;
export const CASE_LEGENDARY_SHARE = 0.0001;
export const CASE_RPG_SHARE = 0.0005;
export const CASE_FONT_SHARE_BY_ID: Record<string, number> = {};

/** Валютные джекпоты — в кейсе своей валюты. Шанс всегда фиксированный. */
export const CASE_CASH_BBC_ID = "cash-bbc-200000";
export const CASE_CASH_BBC_AMOUNT = 200_000;
export const CASE_CASH_BD_ID = "cash-bd-1000000";
export const CASE_CASH_BD_AMOUNT = 1_000_000;
/** @deprecated используй CASE_JACKPOT_CHANCE_PCT из marketCaseBoost */
export const CASE_JACKPOT_SHARE = CASE_JACKPOT_CHANCE_PCT / 100;
export { CASE_JACKPOT_CHANCE_PCT };

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

/**
 * Орг. стримеры (не игроки BB) — кейсы только «в разработке».
 * Канон: docs/BB-ORG-STREAMERS.md
 */
export const CASE_ORG_STREAMER_STEAM_IDS = new Set([
  "76561199421997729", // Shmeliys
]);

/** Кейсы: только ClanMember [BB]; стримерам орг. — нет (заглушка WIP). */
export async function canAccessMarketCases(
  steamId: string | null | undefined
): Promise<boolean> {
  const sid = String(steamId || "").trim();
  if (!sid) return false;
  if (CASE_ORG_STREAMER_STEAM_IDS.has(sid)) return false;
  const row = await prisma.clanMember.findFirst({
    where: {
      user: { steamId: sid },
      clan: { tag: "BB", isExternal: false },
    },
    select: { id: true },
  });
  return Boolean(row);
}

type RawItem = {
  key: string;
  kind: "patch" | "bg" | "font";
  itemId: string;
  title: string;
  image: string | null;
  cssClass?: string | null;
  /** Цена для весов шанса (купить или оценка продажи). */
  price: number;
  sellPrice: number;
  sellCurrency: MarketCurrency;
};

async function loadCasePool(currency: MarketCurrency): Promise<RawItem[]> {
  const out: RawItem[] = [];
  for (const id of MARKET_PATCH_ORDER) {
    // РПГ — только BD-кейс; остальные sell-only (СВД/РГ-6) — в оба.
    if (id === CASE_RPG_PATCH_ID && currency !== "BD") continue;
    const price = await resolveListingPrice("patch", id);
    const cur = id.startsWith("bd-faction-")
      ? "BD"
      : id === CASE_RPG_PATCH_ID
        ? "BD"
        : price?.currency ?? patchDefaultCurrency(id);
    // Sell-only легендарки считаем доступными в обоих кейсах (BBC/BD),
    // вес — по цене продажи.
    const isExclusive =
      id === CASE_LEGENDARY_PATCH_ID ||
      id === CASE_GP_PATCH_ID ||
      id === CASE_RPG_PATCH_ID;
    if (!isExclusive && cur !== currency) continue;
    if (isExclusive && id === CASE_RPG_PATCH_ID && currency !== "BD") continue;
    const meta = marketPatchMeta(id);
    const buy = price?.buy ?? meta.buy;
    const sell = price?.sell ?? meta.sell;
    const weightPrice = isExclusive
      ? id === CASE_LEGENDARY_PATCH_ID
        ? CASE_LEGENDARY_SELL
        : id === CASE_GP_PATCH_ID
          ? CASE_GP_SELL
          : CASE_RPG_SELL
      : buy;
    out.push({
      key: `patch:${id}`,
      kind: "patch",
      itemId: id,
      title: meta.title,
      image: meta.image,
      price: weightPrice,
      sellPrice: sell,
      // СВД / ГП всегда продаются за BBC (даже из BD-кейса); РПГ — только $.
      sellCurrency: isExclusive
        ? id === CASE_RPG_PATCH_ID
          ? "BD"
          : "BBC"
        : cur,
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
  // Шрифты — только BBC-кейс, вес по цене купить.
  if (currency === "BBC") {
    for (const id of MARKET_FONT_ORDER) {
      const meta = marketFontMeta(id);
      out.push({
        key: `font:${id}`,
        kind: "font",
        itemId: id,
        title: meta.title,
        image: null,
        cssClass: meta.cssClass || null,
        price: meta.buy,
        sellPrice: meta.sell,
        sellCurrency: "BBC",
      });
    }
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

/** Собрать таблицу шансов (сумма ≈ 100). Предметы: шанс ∝ 1/цене. */
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
    const sum = entries.reduce((a, e) => a + e.chancePct, 0);
    if (entries[0] && Math.abs(sum - 100) > 0.05) {
      entries[0].chancePct =
        Math.round((entries[0].chancePct + (100 - sum)) * 100) / 100;
    }
    return entries.sort((a, b) => b.chancePct - a.chancePct);
  }

  // Один пул на оба кейса: дороже цена → строго ниже шанс.
  const itemsShare = Math.max(0.01, 1 - fillerShare);
  const invWeights = pool.map((p) => 1 / Math.max(1, p.price));
  const invSum = invWeights.reduce((a, b) => a + b, 0) || 1;

  for (let i = 0; i < pool.length; i++) {
    const p = pool[i];
    const share = itemsShare * (invWeights[i] / invSum);
    entries.push({
      key: p.key,
      kind: p.kind,
      itemId: p.itemId,
      title: p.title,
      image: p.image,
      cssClass: p.cssClass ?? null,
      price: p.price,
      sellPrice: p.sellPrice,
      sellCurrency: p.sellCurrency,
      chancePct: Math.round(share * 10000) / 100,
    });
  }

  // Нормализация на самый частый филлер.
  const sum = entries.reduce((a, e) => a + e.chancePct, 0);
  if (sum > 0 && Math.abs(sum - 100) > 0.05 && entries[0]) {
    entries[0].chancePct =
      Math.round((entries[0].chancePct + (100 - sum)) * 100) / 100;
  }

  return entries.sort((a, b) => b.chancePct - a.chancePct);
}

function cashJackpotEntry(currency: MarketCurrency): CaseLootEntry {
  if (currency === "BBC") {
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
      chancePct: 0, // пересчитается вместе с предметами
    };
  }
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
    chancePct: 0,
  };
}

/**
 * Джекпот валюты — в общий ценовой пул (200k / 1M → самый низкий шанс).
 * Эксклюзивы и шрифты уже в loadCasePool.
 */
export function injectCaseSpecials(
  entries: CaseLootEntry[],
  currency: MarketCurrency
): CaseLootEntry[] {
  const jackpot = cashJackpotEntry(currency);
  const without = entries.filter((e) => e.itemId !== jackpot.itemId);
  const fillers = without.filter(
    (e) => e.kind === "currency" && isCaseFillerCash(e.itemId)
  );
  const priced = without.filter(
    (e) => !(e.kind === "currency" && isCaseFillerCash(e.itemId))
  );
  const pool = [...priced, jackpot];
  const fillerPct = fillers.reduce((a, e) => a + e.chancePct, 0);
  const itemsShare = Math.max(0.01, 100 - fillerPct);
  const weights = pool.map((p) => 1 / Math.max(1, p.price));
  const wSum = weights.reduce((a, b) => a + b, 0) || 1;
  for (let i = 0; i < pool.length; i++) {
    pool[i].chancePct =
      Math.round(((itemsShare * weights[i]) / wSum) * 100) / 100;
  }
  const next = [...fillers, ...pool];
  // Жёстко фиксируем джекпот: 0.02%, остальное пропорционально сжимаем.
  const jpRow = next.find((e) => e.itemId === jackpot.itemId);
  if (jpRow) {
    const others = next.filter((e) => e !== jpRow);
    const otherSum = others.reduce((a, e) => a + e.chancePct, 0) || 1;
    const targetOthers = Math.max(0.01, 100 - CASE_JACKPOT_CHANCE_PCT);
    for (const e of others) {
      e.chancePct =
        Math.round(((e.chancePct * targetOthers) / otherSum) * 100) / 100;
    }
    jpRow.chancePct = CASE_JACKPOT_CHANCE_PCT;
  }
  const sum = next.reduce((a, e) => a + e.chancePct, 0);
  const pad = fillers.slice().sort((a, b) => b.chancePct - a.chancePct)[0];
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

/** Последний pityNextAt по этому кейсу (абсолютный номер открытия). */
async function readPityNextAt(
  userId: string,
  caseId: MarketCaseId
): Promise<number | null> {
  const rows = await prisma.actionLog.findMany({
    where: {
      category: "cases",
      action: "case_open",
      actorId: userId,
    },
    select: { meta: true },
    take: 80,
    orderBy: { createdAt: "desc" },
  });
  for (const r of rows) {
    const meta =
      r.meta && typeof r.meta === "object" && !Array.isArray(r.meta)
        ? (r.meta as Record<string, unknown>)
        : null;
    if (meta?.caseId !== caseId) continue;
    const n = Number(meta.pityNextAt);
    if (Number.isFinite(n) && n > 0) return Math.trunc(n);
  }
  return null;
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

function jackpotItemId(currency: MarketCurrency): string {
  return currency === "BBC" ? CASE_CASH_BBC_ID : CASE_CASH_BD_ID;
}

function paintJackpotAmount(
  entry: CaseLootEntry,
  currency: MarketCurrency,
  amount: number
): CaseLootEntry {
  if (entry.itemId !== jackpotItemId(currency)) return entry;
  const n = Math.max(0, Math.trunc(amount));
  const mark = currency === "BD" ? BD_MARK : "BBC";
  return {
    ...entry,
    amount: n,
    sellPrice: n,
    title: `${n.toLocaleString("ru-RU")} ${mark}`,
  };
}

function boostedRollTable(
  table: CaseLootEntry[],
  kind: CaseBoostKind,
  caseId: MarketCaseId
): CaseLootEntry[] {
  void kind;
  void caseId;
  // Джекпот вне буста — остаётся CASE_JACKPOT_CHANCE_PCT.
  return applyGroupBoost(table, [
    { ids: new Set([CASE_RPG_PATCH_ID]), addPct: CASE_RED_RARE_ADD, perItem: true },
    {
      ids: new Set(CASE_PITY_PATCH_IDS),
      addPct: CASE_RED_IMMORTAL_ADD,
      perItem: true,
    },
  ]);
}

function boostNote(kind: CaseBoostKind, caseId: MarketCaseId): string {
  void kind;
  void caseId;
  return `буст каждому: Rare +${CASE_RED_RARE_ADD}%, Immortal +${CASE_RED_IMMORTAL_ADD}% (джекпот без буста ${CASE_JACKPOT_CHANCE_PCT}%)`;
}

/** Хватает ли баланса на несколько прокрутов сразу, до первого списания. */
export async function ensureCaseFunds(opts: {
  caseId: MarketCaseId;
  userId: string;
  steamId: string;
  boostKind?: CaseBoostKind | null;
  count: number;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (hasInfiniteMarketWallet(opts.steamId)) return { ok: true };
  const def = getMarketCase(opts.caseId);
  if (!def) return { ok: false, error: "case" };
  const unit = opts.boostKind ? caseBoostKindPrice(opts.boostKind, def.id) : def.price;
  const need = unit * Math.max(1, opts.count);
  if (def.currency === "BBC") {
    const bal = await getBbCoinBalance(opts.userId);
    if (bal < need) return { ok: false, error: "insufficient" };
    return { ok: true };
  }
  const ctx = await getFactionPayCtx(opts.userId, opts.steamId);
  if (!ctx) return { ok: false, error: "no_faction" };
  // Кейсы за $ — только личный B$, казна не тратится.
  const personal = await getPersonalBdBalance(opts.userId);
  if (personal < need) return { ok: false, error: "insufficient" };
  return { ok: true };
}

const SPIN_STALE_MS = CASE_SPIN_MS + 30_000;

async function refundCaseSpend(opts: {
  userId: string;
  steamId: string;
  spent: number;
  currency: MarketCurrency;
  paidFrom: string | null | undefined;
  caseName: string;
}): Promise<void> {
  const spent = Math.max(0, Math.trunc(opts.spent));
  if (!spent || opts.paidFrom === "infinite") return;
  const note = `Откат прокрута «${opts.caseName}» (+${spent.toLocaleString("ru-RU")} ${
    opts.currency === "BD" ? BD_MARK : "BBC"
  })`;
  if (opts.currency === "BBC" || opts.paidFrom === "bbc") {
    await creditBbCoins({
      userId: opts.userId,
      amount: spent,
      kind: "case_open_refund",
      ref: `refund:${opts.userId}:${Date.now()}:${randomBytes(4).toString("hex")}`,
      note,
    });
    return;
  }
  if (opts.paidFrom === "personal") {
    await creditPersonalBd({ userId: opts.userId, amount: spent });
    return;
  }
  if (opts.paidFrom === "treasury") {
    const ctx = await getFactionPayCtx(opts.userId, opts.steamId);
    if (!ctx) return;
    await creditFactionBd({
      factionId: ctx.factionId,
      amount: spent,
      userId: opts.userId,
      note,
      sourceKey: `case_open_refund:${opts.userId}:${Date.now()}`,
    });
  }
}

/** Откатить незавершённые прокруты (refresh / уход со страницы / протухший lock). */
export async function abortPendingCaseSpins(opts: {
  userId: string;
  steamId: string;
  batchId?: string;
}): Promise<{ ok: true; aborted: number }> {
  const rows = await prisma.caseSpinPending.findMany({
    where: opts.batchId
      ? { userId: opts.userId, batchId: opts.batchId }
      : { userId: opts.userId },
  });
  if (!rows.length) return { ok: true, aborted: 0 };

  for (const row of rows) {
    const def = getMarketCase(row.caseId);
    const caseName = def?.name || row.caseId;
    const currency = (row.currency === "BD" ? "BD" : "BBC") as MarketCurrency;
    if (row.paidFrom !== "infinite") {
      await subtractCaseJackpot(currency, row.spent);
    }
    if (row.jackpotHit && row.jackpotPaid > 0) {
      await returnCaseJackpotPayout(currency, row.jackpotPaid);
    }
    await refundCaseSpend({
      userId: opts.userId,
      steamId: opts.steamId,
      spent: row.spent,
      currency,
      paidFrom: row.paidFrom,
      caseName,
    });
  }
  await prisma.caseSpinPending.deleteMany({
    where: { id: { in: rows.map((r) => r.id) } },
  });
  return { ok: true, aborted: rows.length };
}

async function settlePendingSpin(
  row: {
    id: string;
    userId: string;
    caseId: string;
    boostKind: string | null;
    spent: number;
    currency: string;
    paidFrom: string | null;
    resultJson: unknown;
    jackpotHit: boolean;
    jackpotPaid: number;
    openIndex: number;
    pityNextAt: number;
    pityForced: boolean;
    rolledChance: number;
  },
  steamId: string
): Promise<{ balance: number; currency: MarketCurrency; paidFrom?: string }> {
  const def = getMarketCase(row.caseId);
  if (!def) throw new Error("case");
  const result = row.resultJson as CaseLootEntry;
  const boostKind = (row.boostKind === "red" ? "red" : null) as CaseBoostKind | null;
  const currency = (row.currency === "BD" ? "BD" : "BBC") as MarketCurrency;
  const jackpotHit = row.jackpotHit;
  const jackpotPaid = row.jackpotPaid;

  if (result.kind === "patch" && result.itemId) {
    await addPatchQty(row.userId, result.itemId, 1);
    await writeNickPatchesCache().catch(() => null);
  } else if (result.kind === "bg" && result.itemId) {
    await addBgQty(row.userId, result.itemId, 1);
  } else if (result.kind === "font" && result.itemId) {
    await addFontQty(row.userId, result.itemId, 1);
  } else if (result.kind === "currency") {
    const amt = Math.max(0, Math.trunc(result.amount || result.sellPrice || 0));
    let credited = false;
    if (amt > 0 && result.sellCurrency === "BBC") {
      const creditedRes = await creditBbCoins({
        userId: row.userId,
        amount: amt,
        kind: "case_drop",
        ref: `${def.id}:${result.itemId || "bbc"}:${row.id}`,
        note: jackpotHit
          ? `Джекпот из кейса «${def.name}»: +${amt.toLocaleString("ru-RU")} BBC`
          : `Дроп из кейса «${def.name}»: +${amt.toLocaleString("ru-RU")} BBC`,
      });
      credited = creditedRes.ok;
    } else if (amt > 0 && result.sellCurrency === "BD") {
      const creditedRes = await creditPersonalBd({ userId: row.userId, amount: amt });
      credited = creditedRes.ok;
    }
    if (jackpotHit && !credited) {
      await restoreCaseJackpotIfFloor(currency, jackpotPaid);
    }
  }

  const actor = await prisma.user.findUnique({
    where: { id: row.userId },
    select: { nick: true, steamName: true, steamId: true },
  });
  const nick = personLabel(actor || { steamId });
  const spendLabel = `${row.spent.toLocaleString("ru-RU")} ${
    currency === "BD" ? BD_MARK : "BBC"
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
  const pityHit = row.pityForced;
  await writeActionLog({
    category: "cases",
    action: "case_open",
    message: boostKind
      ? `${nick} открыл «${def.name}» с ${boostNote(boostKind, def.id)} (−${spendLabel}) → ${dropLabel}`
      : `${nick} открыл «${def.name}» (−${spendLabel}) → ${dropLabel}`,
    actorId: row.userId,
    actorNick: nick,
    meta: {
      caseId: def.id,
      caseName: def.name,
      currency,
      spent: row.spent,
      dropKind: result.kind,
      dropItemId: result.itemId,
      dropTitle: result.kind === "empty" ? "Пусто" : result.title,
      dropImage: result.image,
      dropSell: result.sellPrice,
      dropSellCurrency: result.sellCurrency,
      chancePct: pityHit ? result.chancePct : row.rolledChance,
      boost: Boolean(boostKind),
      boostKind,
      boostRareAddPct: boostKind === "red" ? CASE_RED_RARE_ADD : undefined,
      boostJackpotAddPct: undefined,
      jackpotClaimed: jackpotHit,
      jackpotPaid: jackpotHit ? jackpotPaid : undefined,
      boostImmortalAddPct: boostKind === "red" ? CASE_RED_IMMORTAL_ADD : undefined,
      infiniteWallet: hasInfiniteMarketWallet(steamId),
      paidFrom: row.paidFrom || null,
      pity:
        pityHit &&
        Boolean(
          result.itemId &&
            (CASE_PITY_PATCH_IDS as readonly string[]).includes(result.itemId)
        ),
      openIndex: row.openIndex,
      pityNextAt: row.pityNextAt,
      pityGapRolled: pityHit ? row.pityNextAt - row.openIndex : undefined,
      spinPendingId: row.id,
    },
  });

  await prisma.caseSpinPending.delete({ where: { id: row.id } }).catch(() => null);

  const balanceOut =
    currency === "BBC"
      ? await getBbCoinBalance(row.userId)
      : row.paidFrom === "personal"
        ? await getPersonalBdBalance(row.userId)
        : (await getFactionPayCtx(row.userId, steamId))?.balance ?? 0;
  return {
    balance: balanceOut,
    currency,
    paidFrom: row.paidFrom || undefined,
  };
}

/** Подтвердить прокруты после анимации — зачислить лут. */
export async function confirmPendingCaseSpins(opts: {
  userId: string;
  steamId: string;
  batchId: string;
}): Promise<
  | {
      ok: true;
      balance: number;
      currency: MarketCurrency;
      paidFrom?: string;
      jackpots: CaseJackpotPools;
      count: number;
    }
  | { ok: false; error: string }
> {
  const rows = await prisma.caseSpinPending.findMany({
    where: { userId: opts.userId, batchId: opts.batchId },
    orderBy: { createdAt: "asc" },
  });
  if (!rows.length) return { ok: false, error: "no_pending" };
  const oldest = rows[0].createdAt.getTime();
  if (Date.now() < oldest + CASE_SPIN_MS - 1500) {
    return { ok: false, error: "too_early" };
  }
  let lastBal = 0;
  let lastCur: MarketCurrency = "BBC";
  let lastPaid: string | undefined;
  for (const row of rows) {
    const settled = await settlePendingSpin(row, opts.steamId);
    lastBal = settled.balance;
    lastCur = settled.currency;
    lastPaid = settled.paidFrom;
  }
  return {
    ok: true,
    balance: lastBal,
    currency: lastCur,
    paidFrom: lastPaid,
    jackpots: await readCaseJackpots(),
    count: rows.length,
  };
}

export async function openMarketCase(opts: {
  caseId: MarketCaseId;
  userId: string;
  steamId: string;
  /** Один прокрут по цене выбранного буста. */
  boostKind?: CaseBoostKind | null;
  /** Общий batch для x2 — один confirm/abort на пачку. */
  batchId?: string;
}): Promise<
  | {
      ok: true;
      caseId: MarketCaseId;
      currency: MarketCurrency;
      balance: number;
      spent: number;
      boost: boolean;
      boostKind: CaseBoostKind | null;
      paidFrom?: "treasury" | "personal" | "bbc" | "infinite";
      result: CaseLootEntry;
      strip: CaseLootEntry[];
      landIndex: number;
      jackpots: CaseJackpotPools;
      batchId: string;
      spinId: string;
      pending: true;
      spinMs: number;
    }
  | { ok: false; error: string }
> {
  if (!(await canAccessMarketCases(opts.steamId))) {
    return { ok: false, error: "wip" };
  }
  const def = getMarketCase(opts.caseId);
  if (!def) return { ok: false, error: "case" };

  const existing = await prisma.caseSpinPending.findMany({
    where: { userId: opts.userId },
    orderBy: { createdAt: "asc" },
  });
  if (existing.length) {
    const age = Date.now() - existing[0].createdAt.getTime();
    const sameBatch = Boolean(
      opts.batchId && existing.every((e) => e.batchId === opts.batchId)
    );
    if (sameBatch) {
      // x2: вторая крутка того же batch
    } else if (age >= SPIN_STALE_MS) {
      await abortPendingCaseSpins({ userId: opts.userId, steamId: opts.steamId });
    } else {
      return { ok: false, error: "spin_in_progress" };
    }
  }

  const table = await getCaseLootTable(def.id);
  if (!table.length) return { ok: false, error: "empty_pool" };

  const boostKind = opts.boostKind || null;
  const pay = boostKind ? caseBoostKindPrice(boostKind, def.id) : def.price;
  const price: ResolvedListingPrice = {
    catalog: "patch",
    itemId: boostKind ? `case:${def.id}:${boostKind}-boost` : `case:${def.id}`,
    currency: def.currency,
    buy: pay,
    sell: 0,
    buyBase: pay,
    sellBase: 0,
    deal: null,
  };

  const charged = await chargeMarketBuy({
    userId: opts.userId,
    steamId: opts.steamId,
    price,
    kind: "case_open",
    noteItem: boostKind
      ? `кейс «${def.name}» · ${boostNote(boostKind, def.id)}`
      : `кейс «${def.name}»`,
  });
  if (!charged.ok) return charged;

  if (charged.paidFrom !== "infinite") {
    await addCaseJackpot(def.currency, pay);
  }

  const opensBefore = await countCaseOpens(opts.userId, def.id);
  const openIndex = opensBefore + 1;
  let pityNextAt = await readPityNextAt(opts.userId, def.id);
  if (pityNextAt == null || pityNextAt <= opensBefore) {
    pityNextAt = opensBefore + rollPityGap();
  }
  const pityHit = openIndex >= pityNextAt;
  const pityPool = CASE_PITY_PATCH_IDS.map((id) =>
    table.find((e) => e.itemId === id)
  ).filter((e): e is CaseLootEntry => Boolean(e));
  const pityPick =
    pityPool.length > 0
      ? pityPool[Math.floor(Math.random() * pityPool.length)]
      : null;
  const rollTable = boostKind
    ? boostedRollTable(table, boostKind, def.id)
    : table;
  const pityForced = Boolean(pityHit && pityPick);
  let result = pityForced && pityPick ? pityPick : pickWeighted(rollTable);
  const rolledChance =
    rollTable.find((e) => e.key === result.key)?.chancePct ?? result.chancePct;
  const jackpotHit =
    result.kind === "currency" && result.itemId === jackpotItemId(def.currency);
  let jackpotPaid = 0;
  if (jackpotHit) {
    jackpotPaid = await claimCaseJackpot(def.currency);
    result = paintJackpotAmount(result, def.currency, jackpotPaid);
  }
  const shownPool = jackpotHit
    ? jackpotPaid
    : (await readCaseJackpots())[def.currency];
  const paintedTable = rollTable.map((entry) =>
    paintJackpotAmount(entry, def.currency, shownPool)
  );
  if (!jackpotHit) result = paintJackpotAmount(result, def.currency, shownPool);
  const pityNextAtOut = pityHit ? openIndex + rollPityGap() : pityNextAt;
  const landIndex = 52;
  const strip = buildRouletteStrip(paintedTable, result, { length: 64, landIndex });
  const batchId = opts.batchId || randomBytes(12).toString("hex");

  const pending = await prisma.caseSpinPending.create({
    data: {
      userId: opts.userId,
      batchId,
      caseId: def.id,
      boostKind,
      spent: pay,
      currency: def.currency,
      paidFrom: charged.paidFrom || null,
      resultJson: result as object,
      stripJson: strip as object[],
      landIndex,
      jackpotHit,
      jackpotPaid,
      openIndex,
      pityNextAt: pityNextAtOut,
      pityForced,
      rolledChance,
    },
  });

  return {
    ok: true,
    caseId: def.id,
    currency: charged.currency,
    balance: charged.balance,
    paidFrom: charged.paidFrom,
    spent: pay,
    boost: Boolean(boostKind),
    boostKind,
    result,
    strip,
    landIndex,
    jackpots: await readCaseJackpots(),
    batchId,
    spinId: pending.id,
    pending: true,
    spinMs: CASE_SPIN_MS,
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
