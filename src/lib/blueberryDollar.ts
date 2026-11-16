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
  "Оценка по явке на TR1–TR5, киллам/ресам/KD за 30 дней и редкости роли. Не обязательная цена сделки — командир ставит свою.";

/** Минимальный состав фракции для участия в трансферах. */
export const TRANSFER_MIN_ROSTER = 30;

/** Лок после сделки (сутки). */
export const TRANSFER_LOCK_DAYS = 14;

/** Минимальная цена выставления / покупки. */
export const TRANSFER_MIN_ASK = 5_000;

/** Пол для оценки / потолок. */
export const ESTIMATE_FLOOR = 15_000;
export const ESTIMATE_CEILING = 220_000;

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
 */
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
  return clamp(rounded, ESTIMATE_FLOOR, ESTIMATE_CEILING);
}

/** Гринд за TRAIN на TR1–TR5 → казна. Масштаб под цены в десятках тысяч. */
export function grindAmountFromTrainStats(opts: {
  kills: number;
  deaths: number;
  nok: number;
  res: number;
  durationSec?: number | null;
}): number {
  const k = Math.max(0, opts.kills | 0);
  const d = Math.max(0, opts.deaths | 0);
  const nok = Math.max(0, opts.nok | 0);
  const res = Math.max(0, opts.res | 0);
  const score = k * 2.2 + nok * 1.4 + res * 1.1 - d * 0.35;
  const dur = opts.durationSec && opts.durationSec > 0 ? opts.durationSec : 3600;
  const timeFactor = Math.min(1.35, Math.max(0.55, dur / 3600));
  // ~200–2200 за катку при нормальной стате
  const raw = score * 18 * timeFactor + 120;
  return Math.max(0, Math.min(2_500, Math.round(raw / 10) * 10));
}

/** Plain-text: «1 240 B$». В React предпочтительнее `<BdAmount />`. */
export function formatBd(n: number): string {
  const v = Math.round(Number(n) || 0);
  return `${v.toLocaleString("ru-RU")} ${BD_MARK}`;
}
