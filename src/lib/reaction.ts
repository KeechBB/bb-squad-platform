/** Тренировка стрельбы — реакция (2 уровня, оба на время) */

export const REACTION_LEVEL = 1;
export const REACTION_LEVEL_MAX = 2;
export const REACTION_ATTEMPTS = 10;
/** Задержка до появления цели, секунды */
export const REACTION_DELAY_MIN_S = 1;
export const REACTION_DELAY_MAX_S = 10;
/** Слишком быстро = чит / промах по замеру */
export const REACTION_MIN_MS = 80;
export const REACTION_MAX_MS = 5000;
/** Штраф за клик мимо цели (1 секунда) */
export const REACTION_MISS_PENALTY_MS = 1000;

/**
 * Ур.2: два шарика на окружности вокруг центра.
 * Радиус = половина максимального отступа от центра до края арены.
 */
export const REACTION_L2_RADIUS_FRACTION = 0.5;
export const REACTION_L2_PAD_PX = 48;

/** Присутствие на вкладке */
export const REACTION_PRESENCE_MS = 45_000;
/** Окно чата на вкладке — очистка каждые 30 мин */
export const REACTION_CHAT_WINDOW_MS = 30 * 60 * 1000;
export const REACTION_CHAT_MAX_LEN = 200;

export type ReactionLevel = 1 | 2;

export function reactionChatWindowStart(now = Date.now()): Date {
  const start = Math.floor(now / REACTION_CHAT_WINDOW_MS) * REACTION_CHAT_WINDOW_MS;
  return new Date(start);
}

export function roundMs3(ms: number): number {
  return Math.round(ms * 1000) / 1000;
}

export function averageMs(attempts: number[]): number {
  if (!attempts.length) return 0;
  const sum = attempts.reduce((a, b) => a + b, 0);
  return roundMs3(sum / attempts.length);
}

/** Показ реакции в секундах с точностью до 0.001 (730 мс → «0.730») */
export function formatSec3(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  return (ms / 1000).toFixed(3);
}

/** @deprecated оба уровня на секундах */
export function formatScore(score: number | null | undefined): string {
  return formatSec3(score);
}

/** @deprecated используй formatSec3 */
export function formatMs3(ms: number | null | undefined): string {
  return formatSec3(ms);
}

export function normalizeLevel(raw: unknown): ReactionLevel {
  const n = Number(raw);
  if (n === 2) return 2;
  return 1;
}

/** Раньше ур.2 был на очки — больше нет. */
export function isScoreLevel(_level: ReactionLevel): boolean {
  return false;
}

export function validateAttempts(raw: unknown): number[] | null {
  if (!Array.isArray(raw) || raw.length !== REACTION_ATTEMPTS) return null;
  const out: number[] = [];
  for (const v of raw) {
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isFinite(n)) return null;
    if (n < REACTION_MIN_MS || n > REACTION_MAX_MS) return null;
    out.push(roundMs3(n));
  }
  return out;
}
