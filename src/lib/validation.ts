export const NICK_RE = /^[A-Za-z0-9_-]{3,20}$/;

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
