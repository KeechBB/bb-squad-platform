/**
 * Платный буст одного прокрута: шанс категории Immortal +5 п.п.
 * Цена кнопки — вместо обычной цены кейса, не сверху.
 */
export const CASE_IMMORTAL_BOOST_ADD_PCT = 5;

export const CASE_BOOST_PRICE = {
  "bbc-urozhay": 5_000,
  "faction-sad": 20_000,
} as const;

export function caseBoostPrice(caseId: string): number | null {
  if (caseId === "bbc-urozhay" || caseId === "faction-sad") {
    return CASE_BOOST_PRICE[caseId];
  }
  return null;
}

type ChanceRow = { itemId: string | null; chancePct: number };

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Поднимает суммарный шанс Immortal на addPct пунктов.
 * Прибавка делится между имморталами пропорционально их текущим шансам.
 * Остальные исходы сжимаются так, чтобы сумма таблицы осталась 100.
 */
export function applyImmortalBoost<T extends ChanceRow>(
  entries: T[],
  immortalIds: ReadonlySet<string>,
  addPct = CASE_IMMORTAL_BOOST_ADD_PCT
): T[] {
  const isImm = (e: ChanceRow) =>
    Boolean(e.itemId && immortalIds.has(e.itemId));
  const imm = entries.filter(isImm);
  const rest = entries.filter((e) => !isImm(e));
  if (!imm.length || !rest.length || addPct <= 0) {
    return entries.map((e) => ({ ...e }));
  }
  const immSum = imm.reduce((a, e) => a + e.chancePct, 0);
  const restSum = rest.reduce((a, e) => a + e.chancePct, 0);
  if (immSum <= 0 || restSum <= 0) {
    return entries.map((e) => ({ ...e }));
  }
  const total = immSum + restSum;
  const targetImm = Math.min(total - 0.5, immSum + addPct);
  const targetRest = total - targetImm;
  const scaled: T[] = [
    ...imm.map((e) => ({
      ...e,
      chancePct: round2(e.chancePct * (targetImm / immSum)),
    })),
    ...rest.map((e) => ({
      ...e,
      chancePct: round2(e.chancePct * (targetRest / restSum)),
    })),
  ];
  const sum = scaled.reduce((a, e) => a + e.chancePct, 0);
  const pad = scaled
    .filter((e) => !isImm(e))
    .sort((a, b) => b.chancePct - a.chancePct)[0];
  if (pad) {
    pad.chancePct = round2(pad.chancePct + (100 - sum));
    if (pad.chancePct < 0) pad.chancePct = 0;
  }
  return scaled.sort((a, b) => b.chancePct - a.chancePct);
}
