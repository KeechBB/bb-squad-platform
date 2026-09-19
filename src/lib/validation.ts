export const NICK_RE = /^[A-Za-z0-9!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?`~]{3,24}$/;

export function isValidNick(nick: string): boolean {
  return NICK_RE.test(nick);
}

export function isValidName(name: string): boolean {
  const t = name.trim();
  return t.length >= 2 && t.length <= 40;
}

export function isValidAge(age: number): boolean {
  return Number.isInteger(age) && age >= 14 && age <= 99;
}

/** YYYY-MM-DD → возраст; null если дата некорректна или возраст вне 14–99 */
export function ageFromBirthDate(isoDate: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const birth = new Date(y, mo - 1, d);
  if (
    birth.getFullYear() !== y ||
    birth.getMonth() !== mo - 1 ||
    birth.getDate() !== d
  ) {
    return null;
  }
  const today = new Date();
  let age = today.getFullYear() - y;
  const hadBirthday =
    today.getMonth() > mo - 1 ||
    (today.getMonth() === mo - 1 && today.getDate() >= d);
  if (!hadBirthday) age -= 1;
  if (!isValidAge(age)) return null;
  return age;
}

export function parseBirthDate(isoDate: string): Date | null {
  if (ageFromBirthDate(isoDate) == null) return null;
  const [y, mo, d] = isoDate.trim().split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, d));
}
