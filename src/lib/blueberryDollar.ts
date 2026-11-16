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
  "Оценка по явке на TR1–TR5, киллам/ресам/KD, редкости роли + сколько B$ игрок принёс в казну гринда (до 1 000). Цена на доске — не ниже 80% от оценки.";

/** Минимальный состав фракции для участия в трансферах. */
export const TRANSFER_MIN_ROSTER = 30;

/** Лок после сделки (сутки). */
export const TRANSFER_LOCK_DAYS = 14;

/** Минимальная цена выставления / покупки. */
export const TRANSFER_MIN_ASK = 5_000;

/** Ниже этой доли от рыночной оценки выставлять нельзя. */
export const TRANSFER_MIN_ASK_RATIO = 0.8;

/** Минимальный ask от оценки (не ниже TRANSFER_MIN_ASK). */
export function minAskFromEstimate(estimate: number): number {
  const fromMarket = Math.ceil(Math.max(0, estimate) * TRANSFER_MIN_ASK_RATIO);
  return Math.max(TRANSFER_MIN_ASK, fromMarket);
}

/** Пол для оценки. Потолка нет — сильные игроки могут уходить выше. */
export const ESTIMATE_FLOOR = 15_000;
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

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n));
}

function roleMult(kitKey?: string | null): number {
  const kit = String(kitKey || "").toLowerCase();
  if (!kit || kit === "unknown" || kit === "—") return 0.95;
  if (kit === "sl" || kit.includes("squad lead")) return 1.55;
  if (kit.includes("medic") || kit === "med") return 1.42;
  if (kit.includes("hat") || kit === "lat" || kit === "at") return 1.35;
  if (kit === "ar" || kit === "mg" || kit.includes("auto")) return 1.2;
  if (kit.includes("eng") || kit.includes("crew") || kit.includes("sapper")) return 1.18;
  if (kit.includes("rifle")) return 1.0;
  return 1.08;
}

function scarcityMult(level: ScarcityForPrice): number {
  if (level === "critical") return 1.45;
  if (level === "thin") return 1.22;
  if (level === "surplus") return 0.88;
  return 1;
}

/**
 * Оценочная стоимость игрока (десятки–сотни тысяч B$).
 *
 * Состав:
 *   база 22k
 * + явка TR (до ~40k за 14/14 дней)
 * + вклад в бою за 30д (киллы / ресы / ноки, с потолком)
 * × KD
 * × роль
 * × дефицит роли во фракции
 * × свежесть онлайна на сайте
 * + гринд в казну (округление до 1 000)
 */
export function roundGrindBonus(grindBroughtBd: number): number {
  const n = Math.max(0, Number(grindBroughtBd) || 0);
  return Math.round(n / 1_000) * 1_000;
}

export function estimatePlayerPrice(stats: Partial<PlayerPriceStats> & {
  /** @deprecated leftover stub */
  sri?: number | null;
} = {}): number {
  const trainDays14 = clamp(Number(stats.trainDays14) || 0, 0, 14);
  const matches30 = Math.max(0, Number(stats.matches30) || 0);
  const kills30 = Math.max(0, Number(stats.kills30) || 0);
  const deaths30 = Math.max(0, Number(stats.deaths30) || 0);
  const res30 = Math.max(0, Number(stats.res30) || 0);
  const nok30 = Math.max(0, Number(stats.nok30) || 0);
  const lastSeenDaysAgo =
    stats.lastSeenDaysAgo == null ? null : Math.max(0, Number(stats.lastSeenDaysAgo));

  const base = 22_000;
  const onlineScore = (trainDays14 / 14) * 40_000;
  const combatRaw = kills30 * 95 + res30 * 120 + nok30 * 55 + matches30 * 320;
  const combatScore = clamp(combatRaw, 0, 85_000);

  const kd = deaths30 > 0 ? kills30 / deaths30 : kills30 > 0 ? Math.min(kills30, 3) : 0.6;
  const kdMult = clamp(0.8 + kd * 0.38, 0.75, 1.65);

  let freshness = 1;
  if (lastSeenDaysAgo != null) {
    if (lastSeenDaysAgo <= 2) freshness = 1.1;
    else if (lastSeenDaysAgo <= 7) freshness = 1.0;
    else if (lastSeenDaysAgo <= 21) freshness = 0.9;
    else freshness = 0.78;
  } else if (trainDays14 === 0 && matches30 === 0) {
    freshness = 0.75;
  }

  const raw =
    (base + onlineScore + combatScore) *
    kdMult *
    roleMult(stats.kitKey) *
    scarcityMult(stats.scarcityLevel) *
    freshness;

  const rounded = Math.round(raw / 500) * 500;
  const grindBonus = roundGrindBonus(Number(stats.grindBroughtBd) || 0);
  return Math.max(ESTIMATE_FLOOR, rounded + grindBonus);
}

/** Тарифы гринда → казна фракции. Линейно, без потолка за катку. */
export const GRIND_RATE_KILL = 85;
export const GRIND_RATE_RES = 110;
/** B$ за единицу урона из статы матча (в т.ч. по технике). */
export const GRIND_RATE_DMG = 0.12;
export const GRIND_RATE_VEHICLE_KILL = 450;

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
 * Гринд за TRAIN на TR1–TR5 → казна.
 * Каждое действие платит отдельно: килл / рес / урон / уничтожение техники.
 * Потолка нет — 50 киллов = 50 × тариф.
 */
export function grindAmountFromTrainStats(opts: {
  kills: number;
  res: number;
  dmg?: number | null;
  vehicleKills?: number | null;
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
  return Math.max(0, Math.round(raw));
}

/** Plain-text: «1 240 B$». В React предпочтительнее `<BdAmount />`. */
export function formatBd(n: number): string {
  const v = Math.round(Number(n) || 0);
  return `${v.toLocaleString("ru-RU")} ${BD_MARK}`;
}
