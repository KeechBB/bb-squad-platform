/** Тренировка стрельбы — реакция + карт-дуэль */

export const REACTION_LEVEL = 1;
export const REACTION_LEVEL_MAX = 3;
export const REACTION_ATTEMPTS = 10;
/** Задержка до появления круга, секунды */
export const REACTION_DELAY_MIN_S = 1;
export const REACTION_DELAY_MAX_S = 10;
/** Слишком быстро = чит / промах по замеру */
export const REACTION_MIN_MS = 80;
export const REACTION_MAX_MS = 5000;
/** Штраф за клик мимо круга на ур.1 (1 секунда) */
export const REACTION_MISS_PENALTY_MS = 1000;

/**
 * Уровень 2 — волна шариков (бывший L3).
 * Константы с префиксом L2; L3_* оставлены как алиасы.
 */
export const REACTION_L2_DURATION_MS = 30_000;
export const REACTION_L2_SPAWN_EVERY_MS = 400;
export const REACTION_L2_BALL_LIFE_MS = 1100;
export const REACTION_L2_SPAWN_MIN = 3;
export const REACTION_L2_SPAWN_MAX = 5;
export const REACTION_L2_HIT_POINTS = 10;
export const REACTION_L2_MISS_POINTS = -5;
export const REACTION_L2_SCORE_MIN = -50_000;
export const REACTION_L2_SCORE_MAX = 50_000;

/** @deprecated use REACTION_L2_* */
export const REACTION_L3_DURATION_MS = REACTION_L2_DURATION_MS;
export const REACTION_L3_SPAWN_EVERY_MS = REACTION_L2_SPAWN_EVERY_MS;
export const REACTION_L3_BALL_LIFE_MS = REACTION_L2_BALL_LIFE_MS;
export const REACTION_L3_SPAWN_MIN = REACTION_L2_SPAWN_MIN;
export const REACTION_L3_SPAWN_MAX = REACTION_L2_SPAWN_MAX;
export const REACTION_L3_HIT_POINTS = REACTION_L2_HIT_POINTS;
export const REACTION_L3_MISS_POINTS = REACTION_L2_MISS_POINTS;
export const REACTION_L3_SCORE_MIN = REACTION_L2_SCORE_MIN;
export const REACTION_L3_SCORE_MAX = REACTION_L2_SCORE_MAX;

/** Карт-дуэль (ур.3) — Elo */
export const RACE_RATING_START = 1000;
export const RACE_RATING_FLOOR = 100;
export const RACE_ELO_K = 25;
export const RACE_LAPS = 5;
export const RACE_QUEUE_TIMEOUT_MS = 60_000;
export const RACE_COUNTDOWN_MS = 3_000;
export const RACE_TICK_MS = 50;
/** Макс. тиков за один advance — меньше = меньше рывков при лагах */
export const RACE_MAX_CATCHUP_TICKS = 6;
export const RACE_TAB_LABEL = "Карт-дуэль";

/** Присутствие на вкладке */
export const REACTION_PRESENCE_MS = 45_000;
/** Окно чата на вкладке — очистка каждые 30 мин */
export const REACTION_CHAT_WINDOW_MS = 30 * 60 * 1000;
export const REACTION_CHAT_MAX_LEN = 200;

export type ReactionLevel = 1 | 2 | 3;

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

export function formatScore(score: number | null | undefined): string {
  if (score == null || !Number.isFinite(score)) return "—";
  return String(Math.round(score));
}

/** @deprecated используй formatSec3 */
export function formatMs3(ms: number | null | undefined): string {
  return formatSec3(ms);
}

export function normalizeLevel(raw: unknown): ReactionLevel {
  const n = Number(raw);
  if (n === 2) return 2;
  if (n === 3) return 3;
  return 1;
}

/** Ур.2 — счёт шариков (выше лучше). Ур.1 — время. Ур.3 — Elo отдельно. */
export function isScoreLevel(level: ReactionLevel): boolean {
  return level === 2;
}

export function isRaceLevel(level: ReactionLevel): boolean {
  return level === 3;
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

export function validateL2Score(raw: unknown): {
  score: number;
  hits: number;
  misses: number;
} | null {
  if (!raw || typeof raw !== "object") return null;
  const body = raw as Record<string, unknown>;
  const score = typeof body.score === "number" ? body.score : Number(body.score);
  const hits = typeof body.hits === "number" ? body.hits : Number(body.hits);
  const misses =
    typeof body.misses === "number" ? body.misses : Number(body.misses);
  if (!Number.isFinite(score) || !Number.isFinite(hits) || !Number.isFinite(misses)) {
    return null;
  }
  if (!Number.isInteger(hits) || hits < 0 || hits > 20_000) return null;
  if (!Number.isInteger(misses) || misses < 0 || misses > 20_000) return null;
  if (score < REACTION_L2_SCORE_MIN || score > REACTION_L2_SCORE_MAX) return null;
  const expected = hits * REACTION_L2_HIT_POINTS + misses * REACTION_L2_MISS_POINTS;
  if (score !== expected) return null;
  return { score: Math.round(score), hits, misses };
}

/** @deprecated use validateL2Score */
export function validateL3Score(raw: unknown) {
  return validateL2Score(raw);
}

/** Elo: ожидание победы A над B */
export function raceEloExpected(ratingA: number, ratingB: number): number {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

export function raceEloDelta(
  ratingA: number,
  ratingB: number,
  aWon: boolean
): { deltaA: number; deltaB: number; nextA: number; nextB: number } {
  const eA = raceEloExpected(ratingA, ratingB);
  const eB = 1 - eA;
  const sA = aWon ? 1 : 0;
  const sB = aWon ? 0 : 1;
  let deltaA = Math.round(RACE_ELO_K * (sA - eA));
  let deltaB = Math.round(RACE_ELO_K * (sB - eB));
  deltaA = Math.max(-RACE_ELO_K, Math.min(RACE_ELO_K, deltaA));
  deltaB = Math.max(-RACE_ELO_K, Math.min(RACE_ELO_K, deltaB));
  const nextA = Math.max(RACE_RATING_FLOOR, ratingA + deltaA);
  const nextB = Math.max(RACE_RATING_FLOOR, ratingB + deltaB);
  return {
    deltaA: nextA - ratingA,
    deltaB: nextB - ratingB,
    nextA,
    nextB,
  };
}
