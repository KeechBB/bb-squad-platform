/**
 * Нормализация ников для сопоставления табло ↔ профиль.
 * "Nestor Mahno" и "NestorMahno" — один ключ.
 * "↯DCAI↯ Wkaf (Dolap)" ↔ "Wkaf (Dolap)" ↔ "Wkaf".
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

/** Снять клан-теги ↯DCAI↯ / 『DCAI』 / [BB] / DCI)(AG … (регистр сохраняем). */
export function stripClanDecorRaw(nick: string): string {
  return String(nick || "")
    .replace(/↯[^↯]*↯/g, " ")
    .replace(/『[^』]*』/g, " ")
    .replace(/\[[^\]]*]/g, " ")
    .replace(/DCI\)\(AG/gi, " ")
    .replace(/[|/\\|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function stripClanDecor(nick: string): string {
  return stripClanDecorRaw(nick).toLowerCase();
}

/** База ника: без клан-тега и без хвоста в скобках (Dolap). */
export function nickBase(nick: string): string {
  return stripClanDecor(nick)
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Компактный ключ для карты: база ника без пробелов. */
export function nickMatchKey(nick: string): string {
  const base = nickBase(nick);
  return nickCompact(base || nick);
}

export function nicksMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (nickKey(a) === nickKey(b) || nickCompact(a) === nickCompact(b)) return true;
  const sa = stripClanDecor(a);
  const sb = stripClanDecor(b);
  if (sa && sb && (sa === sb || nickCompact(sa) === nickCompact(sb))) return true;
  const ba = nickBase(a);
  const bb = nickBase(b);
  return Boolean(ba && bb && ba === bb);
}

/** Канон через aliases из tiers.json + compact (+ clan-tag strip). */
export function resolveNickKey(
  nick: string,
  aliases: Record<string, string> = {}
): string {
  const variants = [
    nickKey(nick),
    nickCompact(nick),
    stripClanDecor(nick),
    nickCompact(stripClanDecor(nick)),
    nickBase(nick),
    nickMatchKey(nick),
  ].filter(Boolean);
  const aliasCanon = new Map<string, string>();
  for (const [a, c] of Object.entries(aliases)) {
    for (const k of [
      nickKey(a),
      nickCompact(a),
      stripClanDecor(a),
      nickCompact(stripClanDecor(a)),
      nickBase(a),
      nickMatchKey(a),
    ]) {
      if (k) aliasCanon.set(k, String(c));
    }
  }
  for (const v of variants) {
    const canon = aliasCanon.get(v);
    if (canon) return nickMatchKey(canon);
  }
  return nickMatchKey(nick);
}
