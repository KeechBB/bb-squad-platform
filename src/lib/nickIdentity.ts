/**
 * Нормализация ников для сопоставления табло ↔ профиль.
 * "Nestor Mahno" и "NestorMahno" — один ключ.
 */

export function nickKey(nick: string): string {
  return String(nick || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/** Без пробелов — склеивает "Nestor Mahno" ↔ "NestorMahno". */
export function nickCompact(nick: string): string {
  return String(nick || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

export function nicksMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  return nickKey(a) === nickKey(b) || nickCompact(a) === nickCompact(b);
}

/** Канон через aliases из tiers.json + compact. */
export function resolveNickKey(
  nick: string,
  aliases: Record<string, string> = {}
): string {
  const key = nickKey(nick);
  const compact = nickCompact(nick);
  const aliasCanon = new Map<string, string>();
  for (const [a, c] of Object.entries(aliases)) {
    aliasCanon.set(nickKey(a), String(c));
    aliasCanon.set(nickCompact(a), String(c));
  }
  const canon =
    aliasCanon.get(key) ||
    aliasCanon.get(compact) ||
    null;
  if (canon) return nickCompact(canon);
  return compact;
}
