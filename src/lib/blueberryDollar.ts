/**
 * Черничный Доллар — валюта трансферной системы фракций.
 * В UI: фиолетовый $ с двумя косыми полосками (`BdMark`).
 * В тексте/API/письмах: B$ (plain).
 * Не путать с BBC на платформе.
 *
 * Гринд только с TR1–TR5.
 */

/** Plain-text знак (письма, API). В интерфейсе — `<BdMark />`. */
export const BD_MARK = "B$";
export const BD_NAME = "Черничный Доллар";

/** Подпись к расчётной цене на доске / при выставлении. */
export const ESTIMATE_LABEL = "оценочная стоимость";
export const ESTIMATE_HINT =
  "Стоимость = 20 000 B$ + весь гринд игрока в казну. Цена на доске — не ниже 80% от оценки.";

/** Стартовая цена любого игрока (база формулы). */
export const ESTIMATE_BASE = 20_000;

/** Минимальный состав фракции для участия в трансферах. */
export const TRANSFER_MIN_ROSTER = 30;

/** Лок после сделки (сутки). */
export const TRANSFER_LOCK_DAYS = 14;

/** Минимальная цена выставления / покупки. */
export const TRANSFER_MIN_ASK = 5_000;

/** Ниже этой доли от рыночной оценки выставлять нельзя. */
export const TRANSFER_MIN_ASK_RATIO = 0.8;

/**
 * Комиссия казны за создание лота (удержание игрока на аукционе).
 * Списывается сразу при выставлении, при снятии лота не возвращается.
 */
export const TRANSFER_LIST_FEE_RATIO = 0.01;

/** Минимальный ask от оценки (не ниже TRANSFER_MIN_ASK). */
export function minAskFromEstimate(estimate: number): number {
  const fromMarket = Math.ceil(Math.max(0, estimate) * TRANSFER_MIN_ASK_RATIO);
  return Math.max(TRANSFER_MIN_ASK, fromMarket);
}

/** Комиссия 1% от ask при создании лота (минимум 1 B$). */
export function listingFeeFromAsk(askPrice: number): number {
  const ask = Math.max(0, Math.round(Number(askPrice) || 0));
  return Math.max(1, Math.round(ask * TRANSFER_LIST_FEE_RATIO));
}

/** Пол = стартовая база. Потолка нет. */
export const ESTIMATE_FLOOR = ESTIMATE_BASE;
/** @deprecated потолок оценки снят; оставлено для совместимости импортов. */
export const ESTIMATE_CEILING = Number.POSITIVE_INFINITY;

export type ScarcityForPrice = "ok" | "thin" | "critical" | "surplus" | null | undefined;

export type PlayerPriceStats = {
  kitKey?: string | null;
  scarcityLevel?: ScarcityForPrice;
  /** Уникальные дни с TRAIN на TR1–TR5 за 14 суток. */
  trainDays14: number;
  /** Матчи TR за 30 суток. */
  matches30: number;
  kills30: number;
  deaths30: number;
  res30: number;
  nok30: number;
  /** Дней с lastSeenAt (если давно — штраф). */
  lastSeenDaysAgo: number | null;
  /**
   * Сколько B$ игрок капнул в казну гринда (сумма проводок kind=grind).
   * К оценке плюсуется, округлённое до 1 000.
   */
  grindBroughtBd?: number;
  /** Средний гринд за одну катку (сумма / число проводок grind). */
  grindAvgPerMatchBd?: number;
};

/**
 * Оценочная стоимость игрока.
 *
 *   20 000 (старт любого игрока)
 * + весь гринд B$, который игрок принёс в казну (все катки)
 *
 * Больше ничего в формулу не входит.
 */
export function roundGrindBonus(grindBroughtBd: number): number {
  // Раньше округляли до 1 000; теперь в стоимость входит полный гринд.
  return Math.max(0, Math.round(Number(grindBroughtBd) || 0));
}

export function estimatePlayerPrice(stats: Partial<PlayerPriceStats> & {
  /** @deprecated leftover stub */
  sri?: number | null;
} = {}): number {
  const grind = roundGrindBonus(Number(stats.grindBroughtBd) || 0);
  return ESTIMATE_BASE + grind;
}

/** Тарифы гринда → казна фракции. Линейно, без потолка за катку. (×2 с 27.11.2026) */
export const GRIND_RATE_KILL = 170;
export const GRIND_RATE_RES = 220;
/** B$ за единицу урона из статы матча (в т.ч. по технике). */
export const GRIND_RATE_DMG = 0.24;
export const GRIND_RATE_VEHICLE_KILL = 900;
/**
 * Бонус за кит «Командир отряда» на TRAIN: >70% длительности матча на SL.
 * Доля от длины катки (не от личного онлайна) — анти-абуз коротким заходом.
 */
export const GRIND_RATE_SL = 2000;
export const GRIND_SL_MIN_FRAC = 0.7;

/**
 * Старт гринда B$: Fool's Road AAS 16.11.2026 21:33 МСК (включительно).
 * Всё раньше этой катки не капает — даже другие карты того же дня.
 */
export const GRIND_START_LEGACY_ID = "16-foolsroad";
/** 2026-11-16 21:33 MSK → UTC */
export const GRIND_START_AT_MS = Date.parse("2026-11-16T18:33:00.000Z");

/** Момент матча (МСК календарь+timeMsk → UTC ms). */
export function matchSortMs(opts: {
  legacyId?: string | null;
  year?: number | null;
  month?: number | null;
  day?: number | null;
  timeMsk?: string | null;
  publishedAt?: Date | string | null;
  startedAt?: Date | string | null;
}): number | null {
  if (opts.legacyId && String(opts.legacyId).toLowerCase() === GRIND_START_LEGACY_ID) {
    return GRIND_START_AT_MS;
  }
  const y = Number(opts.year) || 0;
  const m = Number(opts.month) || 0;
  const d = Number(opts.day) || 0;
  if (y >= 2020 && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
    const parts = String(opts.timeMsk || "00:00").split(":");
    const hh = Number(parts[0]) || 0;
    const mm = Number(parts[1]) || 0;
    return Date.UTC(y, m - 1, d, hh - 3, mm, 0);
  }
  const raw = opts.startedAt || opts.publishedAt;
  if (!raw) return null;
  const dt = raw instanceof Date ? raw : new Date(raw);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.getTime();
}

export function isGrindEligibleMatch(opts: {
  legacyId?: string | null;
  year?: number | null;
  month?: number | null;
  day?: number | null;
  timeMsk?: string | null;
  publishedAt?: Date | string | null;
  startedAt?: Date | string | null;
}): boolean {
  const t = matchSortMs(opts);
  if (t == null) return false;
  return t >= GRIND_START_AT_MS;
}

/**
 * +GRIND_RATE_SL B$ если время на ките «Командир отряда» > 70% длины матча.
 * `matchDurationSec` — длительность катки; `slKitSec` — секунды на SL в окне матча.
 */
export function grindSlBonusFromKitTime(opts: {
  slKitSec?: number | null;
  matchDurationSec?: number | null;
}): number {
  const dur = Math.max(0, Number(opts.matchDurationSec) || 0);
  const sl = Math.max(0, Number(opts.slKitSec) || 0);
  if (dur < 60 || sl <= 0) return 0;
  if (sl / dur > GRIND_SL_MIN_FRAC) return GRIND_RATE_SL;
  return 0;
}

/**
 * Гринд за TRAIN на TR1–TR5 → казна.
 * Каждое действие платит отдельно: килл / рес / урон / уничтожение техники.
 * Плюс бонус SL (>70% длины матча на ките командира отряда).
 * Потолка нет — 50 киллов = 50 × тариф.
 */
export function grindAmountFromTrainStats(opts: {
  kills: number;
  res: number;
  dmg?: number | null;
  vehicleKills?: number | null;
  /** Секунды на ките «Командир отряда» в окне матча. */
  slKitSec?: number | null;
  /** Длительность матча (сек) — знаменатель для порога SL. */
  matchDurationSec?: number | null;
  /** @deprecated не влияет на сумму; оставлено для совместимости вызовов */
  deaths?: number;
  nok?: number;
  durationSec?: number | null;
}): number {
  const k = Math.max(0, Math.floor(Number(opts.kills) || 0));
  const res = Math.max(0, Math.floor(Number(opts.res) || 0));
  const dmg = Math.max(0, Number(opts.dmg) || 0);
  const veh = Math.max(0, Math.floor(Number(opts.vehicleKills) || 0));
  const raw =
    k * GRIND_RATE_KILL +
    res * GRIND_RATE_RES +
    dmg * GRIND_RATE_DMG +
    veh * GRIND_RATE_VEHICLE_KILL;
  const sl = grindSlBonusFromKitTime({
    slKitSec: opts.slKitSec,
    matchDurationSec: opts.matchDurationSec ?? opts.durationSec,
  });
  return Math.max(0, Math.round(raw) + sl);
}

/** Plain-text: «1 240 B$». В React предпочтительнее `<BdAmount />`. */
export function formatBd(n: number): string {
  const v = Math.round(Number(n) || 0);
  return `${v.toLocaleString("ru-RU")} ${BD_MARK}`;
}
