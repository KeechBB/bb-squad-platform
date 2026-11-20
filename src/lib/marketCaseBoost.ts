/**
 * Платные бусты одного прокрута. Цена кнопки — вместо обычной цены кейса.
 * Прибавка в процентных пунктах к выбранной группе, остальное сжимается.
 */
export type CaseBoostKind = "red";

/** Красная кнопка: каждому предмету своей категории, целиком. */
export const CASE_RED_RARE_ADD = 7;
/** Джекпот красной кнопки: 7 500 BBC — 1,5 пункта, 20 000 $ — 3. */
export const CASE_RED_JACKPOT_ADD_BBC = 1.5;
export const CASE_RED_JACKPOT_ADD = 3;
export const CASE_RED_IMMORTAL_ADD = 5;

export function caseRedJackpotAdd(caseId: string): number {
  return caseId === "bbc-urozhay" ? CASE_RED_JACKPOT_ADD_BBC : CASE_RED_JACKPOT_ADD;
}

export const CASE_IMMORTAL_BOOST_ADD_PCT = CASE_RED_IMMORTAL_ADD;

export const CASE_BOOST_KIND_PRICE: Record<
  CaseBoostKind,
  { "bbc-urozhay": number; "faction-sad": number }
> = {
  red: { "bbc-urozhay": 7_500, "faction-sad": 20_000 },
};

/** @deprecated цена красной кнопки. */
export const CASE_BOOST_PRICE = CASE_BOOST_KIND_PRICE.red;

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
  return CASE_BOOST_KIND_PRICE.red[caseId];
}

type ChanceRow = { itemId: string | null; chancePct: number };

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export type ChanceBoostGroup = {
  ids: ReadonlySet<string>;
  addPct: number;
  /** true: +addPct каждому предмету. Иначе +addPct к сумме группы. */
  perItem?: boolean;
};

/**
 * Буст группы. perItem прибавляет пункты каждому предмету отдельно.
 * Иначе прибавка одна на всю группу и делится пропорционально.
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
      perItem: g.perItem === true,
      items: buckets[i],
      sum: buckets[i].reduce((a, e) => a + e.chancePct, 0),
    }))
    .filter((g) => g.items.length > 0 && g.sum > 0 && g.addPct > 0);

  if (!active.length || !rest.length) {
    return entries.map((e) => ({ ...e }));
  }

  const restSum = rest.reduce((a, e) => a + e.chancePct, 0);
  const total = entries.reduce((a, e) => a + e.chancePct, 0) || 100;
  const addedOf = (g: (typeof active)[number]) =>
    g.perItem ? g.addPct * g.items.length : g.addPct;
  let addSum = active.reduce((a, g) => a + addedOf(g), 0);
  const maxAdd = Math.max(0, restSum - 0.5);
  if (addSum > maxAdd && addSum > 0) {
    const scale = maxAdd / addSum;
    for (const g of active) g.addPct *= scale;
    addSum = active.reduce((a, g) => a + addedOf(g), 0);
  }

  const targetRest = total - active.reduce((a, g) => a + g.sum + addedOf(g), 0);
  const scaled: T[] = [];
  for (const g of active) {
    if (g.perItem) {
      for (const e of g.items) {
        scaled.push({ ...e, chancePct: round2(e.chancePct + g.addPct) });
      }
      continue;
    }
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

/** Каждому Immortal +addPct пунктов: 0,11 → 5,11 и 0,09 → 5,09. */
export function applyImmortalBoost<T extends ChanceRow>(
  entries: T[],
  immortalIds: ReadonlySet<string>,
  addPct = CASE_IMMORTAL_BOOST_ADD_PCT
): T[] {
  return applyGroupBoost(entries, [{ ids: immortalIds, addPct, perItem: true }]);
}
