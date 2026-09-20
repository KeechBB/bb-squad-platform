/** Тренировка стрельбы — реакция, уровень 1 */

export const REACTION_LEVEL = 1;
export const REACTION_ATTEMPTS = 10;
/** Задержка до появления круга, секунды */
export const REACTION_DELAY_MIN_S = 1;
export const REACTION_DELAY_MAX_S = 10;
/** Слишком быстро = чит / промах по замеру */
export const REACTION_MIN_MS = 80;
export const REACTION_MAX_MS = 5000;
/** Присутствие на вкладке */
export const REACTION_PRESENCE_MS = 45_000;

export function roundMs3(ms: number): number {
  return Math.round(ms * 1000) / 1000;
}

export function averageMs(attempts: number[]): number {
  if (!attempts.length) return 0;
  const sum = attempts.reduce((a, b) => a + b, 0);
  return roundMs3(sum / attempts.length);
}

export function formatMs3(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  return ms.toFixed(3);
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
