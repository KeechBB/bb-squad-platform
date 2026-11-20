/**
 * Платные бусты одного прокрута. Цена кнопки — вместо обычной цены кейса.
 * Прибавка в процентных пунктах к выбранной группе, остальное сжимается.
 */
export type CaseBoostKind = "immortal" | "rare" | "drop";

export const CASE_IMMORTAL_BOOST_ADD_PCT = 5;
export const CASE_RARE_BOOST_ADD_PCT = 7;
export const CASE_JACKPOT_BOOST_ADD_PCT = 3;
export const CASE_DROP_BOOST_ADD_PCT = 15;

export const CASE_BOOST_KIND_PRICE: Record<
  CaseBoostKind,
  { "bbc-urozhay": number; "faction-sad": number }
> = {
  immortal: { "bbc-urozhay": 5_000, "faction-sad": 20_000 },
  /** +7 Rare и +3 джекпот: та же цена за пункт, что у Immortal. */
  rare: { "bbc-urozhay": 10_000, "faction-sad": 40_000 },
  drop: { "bbc-urozhay": 15_000, "faction-sad": 50_000 },
};

/** @deprecated цена кнопки Immortal. Оставлена для старых вызовов. */
export const CASE_BOOST_PRICE = CASE_BOOST_KIND_PRICE.immortal;

export function caseBoostPrice(caseId: string): number | null {
  if (caseId === "bbc-urozhay" || caseId === "faction-sad") {
    return CASE_BOOST_PRICE[caseId];
  }
  return null;
}

export function caseBoostKindPrice(
  kind: CaseBoostKind,
  caseId: "bbc-urozhay" | "faction-sad"
): number {
  return CASE_BOOST_KIND_PRICE[kind][caseId];
}

type ChanceRow = { itemId: string | null; chancePct: number };

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export type ChanceBoostGroup = {
  ids: ReadonlySet<string>;
  addPct: number;
};

/**
 * Каждой группе добавляет addPct пунктов (делится пропорционально текущим шансам).
 * Пустая группа пропускается. Остальные исходы сжимаются, сумма остаётся 100.
 */
export function applyGroupBoost<T extends ChanceRow>(
  entries: T[],
  groups: ChanceBoostGroup[]
): T[] {
  const groupIndex = (e: ChanceRow): number => {
    if (!e.itemId) return -1;
    for (let i = 0; i < groups.length; i++) {
      if (groups[i].addPct > 0 && groups[i].ids.has(e.itemId)) return i;
    }
    return -1;
  };

  const buckets: T[][] = groups.map(() => []);
  const rest: T[] = [];
  for (const e of entries) {
    const idx = groupIndex(e);
    if (idx >= 0) buckets[idx].push(e);
    else rest.push(e);
  }

  const active = groups
    .map((g, i) => ({
      addPct: g.addPct,
      items: buckets[i],
      sum: buckets[i].reduce((a, e) => a + e.chancePct, 0),
    }))
    .filter((g) => g.items.length > 0 && g.sum > 0 && g.addPct > 0);

  if (!active.length || !rest.length) {
    return entries.map((e) => ({ ...e }));
  }

  const restSum = rest.reduce((a, e) => a + e.chancePct, 0);
  const total = entries.reduce((a, e) => a + e.chancePct, 0) || 100;
  let addSum = active.reduce((a, g) => a + g.addPct, 0);
  const maxAdd = Math.max(0, restSum - 0.5);
  if (addSum > maxAdd && addSum > 0) {
    const scale = maxAdd / addSum;
    for (const g of active) g.addPct *= scale;
    addSum = maxAdd;
  }

  const targetRest = total - active.reduce((a, g) => a + g.sum + g.addPct, 0);
  const scaled: T[] = [];
  for (const g of active) {
    const target = g.sum + g.addPct;
    for (const e of g.items) {
      scaled.push({
        ...e,
        chancePct: round2(e.chancePct * (target / g.sum)),
      });
    }
  }
  for (const e of rest) {
    scaled.push({
      ...e,
      chancePct: round2(
        restSum > 0 ? e.chancePct * (targetRest / restSum) : e.chancePct
      ),
    });
  }

  const sum = scaled.reduce((a, e) => a + e.chancePct, 0);
  const pad = scaled
    .filter((e) => groupIndex(e) < 0)
    .sort((a, b) => b.chancePct - a.chancePct)[0];
  if (pad) {
    pad.chancePct = round2(pad.chancePct + (100 - sum));
    if (pad.chancePct < 0) pad.chancePct = 0;
  }
  return scaled.sort((a, b) => b.chancePct - a.chancePct);
}

/** Поднимает суммарный шанс Immortal на addPct пунктов. */
export function applyImmortalBoost<T extends ChanceRow>(
  entries: T[],
  immortalIds: ReadonlySet<string>,
  addPct = CASE_IMMORTAL_BOOST_ADD_PCT
): T[] {
  return applyGroupBoost(entries, [{ ids: immortalIds, addPct }]);
}
