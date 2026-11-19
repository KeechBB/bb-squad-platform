/**
 * Кейсы площадки: Сад Фракции (B$) и Урожай BlackBerry (BBC).
 * Шансы ∝ 1/цене; Эмка / Призрак < 1%; ~50% пусто.
 */
import { addBgQty } from "@/lib/profileBgStock";
import { addPatchQty } from "@/lib/nickPatchStock";
import { writeNickPatchesCache } from "@/lib/nickPatchesCache";
import { marketPatchMeta, patchDefaultCurrency } from "@/lib/bbCoinPatchPrices";
import { marketBgMeta } from "@/lib/bbCoinBgPrices";
import { MARKET_PATCH_ORDER } from "@/lib/marketPatchIds";
import { MARKET_BG_ORDER } from "@/lib/marketBgIds";
import { resolveListingPrice } from "@/lib/marketListingPrices";
import { chargeMarketBuy } from "@/lib/marketCharge";
import { isBuiltinSuperAdmin } from "@/lib/admin";
import type { MarketCurrency, ResolvedListingPrice } from "@/lib/marketListingPrices";
import { BD_MARK, BD_NAME } from "@/lib/blueberryDollar";

export type MarketCaseId = "faction-sad" | "bbc-urozhay";

export type CaseLootKind = "patch" | "bg" | "empty";

export type CaseLootEntry = {
  key: string;
  kind: CaseLootKind;
  itemId: string | null;
  title: string;
  image: string | null;
  /** Цена купить (для весов редкости). */
  price: number;
  /** Текущая цена продажи на площадке. */
  sellPrice: number;
  /** Валюта продажи: BBC или BD ($). */
  sellCurrency: MarketCurrency | null;
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

export const NOTHING_SHARE = 0.5;
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

export function canAccessMarketCases(steamId: string | null | undefined): boolean {
  return isBuiltinSuperAdmin(steamId);
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

/** Собрать таблицу шансов (сумма ≈ 100). */
export function buildLootChances(pool: RawItem[]): CaseLootEntry[] {
  if (pool.length === 0) {
    return [
      {
        key: "empty",
        kind: "empty",
        itemId: null,
        title: "Пусто",
        image: null,
        price: 0,
        sellPrice: 0,
        sellCurrency: null,
        chancePct: 100,
      },
    ];
  }

  const ultra = pool.filter((p) => CASE_ULTRA_ITEM_IDS.has(p.itemId));
  const normal = pool.filter((p) => !CASE_ULTRA_ITEM_IDS.has(p.itemId));

  const ultraEach = Math.min(
    ULTRA_MAX_SHARE,
    ultra.length ? NOTHING_SHARE / (ultra.length + 2) : 0
  );
  const ultraTotal = ultraEach * ultra.length;
  const itemsShare = Math.max(0.05, 1 - NOTHING_SHARE - ultraTotal);
  const nothingShare = 1 - itemsShare - ultraTotal;

  const invWeights = normal.map((p) => 1 / Math.max(1, p.price));
  const invSum = invWeights.reduce((a, b) => a + b, 0) || 1;

  const entries: CaseLootEntry[] = [];
  entries.push({
    key: "empty",
    kind: "empty",
    itemId: null,
    title: "Пусто",
    image: null,
    price: 0,
    sellPrice: 0,
    sellCurrency: null,
    chancePct: Math.round(nothingShare * 10000) / 100,
  });

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

  // Нормализация до 100 из‑за округления
  const sum = entries.reduce((a, e) => a + e.chancePct, 0);
  if (sum > 0 && Math.abs(sum - 100) > 0.05) {
    const empty = entries.find((e) => e.kind === "empty");
    if (empty) empty.chancePct = Math.round((empty.chancePct + (100 - sum)) * 100) / 100;
  }

  return entries.sort((a, b) => b.chancePct - a.chancePct);
}

export async function getCaseLootTable(caseId: MarketCaseId): Promise<CaseLootEntry[]> {
  const def = getMarketCase(caseId);
  if (!def) return [];
  const pool = await loadCasePool(def.currency);
  return buildLootChances(pool);
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

/** Лента для анимации CS-рулетки (клиент тоже может строить, сервер отдаёт seed-результат). */
export function buildRouletteStrip(
  entries: CaseLootEntry[],
  winner: CaseLootEntry,
  opts?: { length?: number; landIndex?: number }
): CaseLootEntry[] {
  const length = opts?.length ?? 64;
  const landIndex = opts?.landIndex ?? 52;
  const weighted: CaseLootEntry[] = [];
  for (const e of entries) {
    const n = Math.max(1, Math.round(e.chancePct));
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

  const result = pickWeighted(table);
  const landIndex = 52;
  const strip = buildRouletteStrip(table, result, { length: 64, landIndex });

  if (result.kind === "patch" && result.itemId) {
    await addPatchQty(opts.userId, result.itemId, 1);
    await writeNickPatchesCache().catch(() => null);
  } else if (result.kind === "bg" && result.itemId) {
    await addBgQty(opts.userId, result.itemId, 1);
  }

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
      nothingChancePct: loot.find((e) => e.kind === "empty")?.chancePct ?? 50,
    });
  }
  return cases;
}
