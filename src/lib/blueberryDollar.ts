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

/** Минимальный состав фракции для участия в трансферах. */
export const TRANSFER_MIN_ROSTER = 30;

/** Лок после сделки (сутки). */
export const TRANSFER_LOCK_DAYS = 14;

/**
 * Оценка «рыночной» цены по SRI и роли (черновик ставок).
 * База 80 + SRI×1.2 + роль.
 */
export function estimatePlayerPrice(opts: {
  sri: number | null | undefined;
  kitKey?: string | null;
}): number {
  const sri = Math.max(0, Number(opts.sri ?? 0) || 0);
  const kit = String(opts.kitKey || "").toLowerCase();
  let roleBonus = 20;
  if (kit.includes("sl") || kit.includes("squad lead") || kit === "sl") roleBonus = 55;
  else if (kit.includes("medic") || kit.includes("med")) roleBonus = 45;
  else if (kit.includes("hat") || kit.includes("at") || kit.includes("lat") || kit.includes("hat"))
    roleBonus = 40;
  else if (kit.includes("ar") || kit.includes("mg") || kit.includes("autorifle")) roleBonus = 35;
  else if (kit.includes("eng") || kit.includes("sapper") || kit.includes("crew")) roleBonus = 30;
  else if (kit.includes("rifle") || kit.includes("rif")) roleBonus = 15;

  const raw = 80 + sri * 1.2 + roleBonus;
  return Math.max(40, Math.round(raw / 5) * 5);
}

/** Гринд за тренировку (TR1–TR5): вклад игрока → B$ в казну фракции. */
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
  const raw = score * 0.45 * timeFactor;
  return Math.max(0, Math.min(45, Math.round(raw)));
}

/** Plain-text: «1 240 B$». В React предпочтительнее `<BdAmount />`. */
export function formatBd(n: number): string {
  const v = Math.round(Number(n) || 0);
  return `${v.toLocaleString("ru-RU")} ${BD_MARK}`;
}
