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

/** ДД.ММ.ГГГГ или YYYY-MM-DD → YYYY-MM-DD, иначе null */
export function toIsoBirthDate(raw: string): string | null {
  const t = raw.trim();
  let y: number;
  let mo: number;
  let d: number;

  const ru = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(t);
  if (ru) {
    d = Number(ru[1]);
    mo = Number(ru[2]);
    y = Number(ru[3]);
  } else {
    const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
    if (!iso) return null;
    y = Number(iso[1]);
    mo = Number(iso[2]);
    d = Number(iso[3]);
  }

  const birth = new Date(y, mo - 1, d);
  if (
    birth.getFullYear() !== y ||
    birth.getMonth() !== mo - 1 ||
    birth.getDate() !== d
  ) {
    return null;
  }
  return `${String(y).padStart(4, "0")}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Дата рождения (ДД.ММ.ГГГГ или YYYY-MM-DD) → возраст 14–99, иначе null */
export function ageFromBirthDate(raw: string): number | null {
  const iso = toIsoBirthDate(raw);
  if (!iso) return null;
  const [y, mo, d] = iso.split("-").map(Number);
  const today = new Date();
  let age = today.getFullYear() - y;
  const hadBirthday =
    today.getMonth() > mo - 1 ||
    (today.getMonth() === mo - 1 && today.getDate() >= d);
  if (!hadBirthday) age -= 1;
  if (!isValidAge(age)) return null;
  return age;
}

export function parseBirthDate(raw: string): Date | null {
  const iso = toIsoBirthDate(raw);
  if (!iso || ageFromBirthDate(raw) == null) return null;
  const [y, mo, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, d));
}

/** Маска ввода: цифры + точки → ДД.ММ.ГГГГ */
export function formatBirthDateInput(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}.${digits.slice(2)}`;
  return `${digits.slice(0, 2)}.${digits.slice(2, 4)}.${digits.slice(4)}`;
}
