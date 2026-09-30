/** Training dedicated servers — same ingest/attendance semantics. */

export const TRAINING_SERVER_KEYS = ["TR1", "TR2"] as const;

export type TrainingServerKey = (typeof TRAINING_SERVER_KEYS)[number];

export function isTrainingServerKey(key: string | null | undefined): boolean {
  const k = (key || "").trim().toUpperCase();
  return (TRAINING_SERVER_KEYS as readonly string[]).includes(k);
}

export function normalizeTrainingServerKey(
  key: string | null | undefined
): TrainingServerKey | null {
  const k = (key || "").trim().toUpperCase();
  if ((TRAINING_SERVER_KEYS as readonly string[]).includes(k)) {
    return k as TrainingServerKey;
  }
  return null;
}
