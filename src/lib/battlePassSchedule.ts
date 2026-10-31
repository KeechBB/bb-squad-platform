/**
 * Календарь Battle Pass (Москва, UTC+3).
 *
 * S1 «Фруктовый Сад» → 31.10.2026
 * Пауза 3 дня → 01.11–03.11.2026 (заглушка на /battle-pass)
 * Season 2 Halloween → с 04.11.2026 (превью: /battle-pass/halloween-preview, Keech)
 */

export const BP_S1_END_MS = Date.parse("2026-10-31T23:59:59+03:00");

/** S1 закрыт: после 31.10.2026 23:59:59 MSK */
export function isBattlePassS1Ended(now: Date = new Date()): boolean {
  return now.getTime() >= BP_S1_END_MS;
}

/** Включительно по календарю: 1, 2, 3 ноября 2026 */
export const BP_INTERMISSION = {
  startMs: Date.parse("2026-11-01T00:00:00+03:00"),
  /** exclusive — в этот момент уже Season 2 */
  endMs: Date.parse("2026-11-04T00:00:00+03:00"),
  title: "Battle Pass",
  eyebrow: "Между сезонами",
  headline: "Скоро новый Battle Pass",
  body:
    "Текущий сезон завершён. Готовим следующий — подождите совсем чуть-чуть.\nСпасибо за игру и за работу на Фруктовом Саде.",
  waitLabel: "Ждите · Season 2",
  windowLabel: "01.11.2026 — 03.11.2026",
} as const;

export const BP_S2_SCHEDULE = {
  startLabel: "04.11.2026",
  endLabel: "30.11.2026",
  title: "Battle Pass Season 2",
  subtitle: "Halloween · Фруктовый Сад",
} as const;

export function isBattlePassIntermission(now: Date = new Date()): boolean {
  const t = now.getTime();
  return t >= BP_INTERMISSION.startMs && t < BP_INTERMISSION.endMs;
}

export function isBattlePassSeason2Live(now: Date = new Date()): boolean {
  return now.getTime() >= BP_INTERMISSION.endMs;
}
