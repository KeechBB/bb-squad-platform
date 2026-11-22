/** Сколько суток МСК входит в основную роль (профиль / киты). */
export const MAIN_ROLE_WINDOW_DAYS = 14;
/** Окно ролей для статистики клана (паблик). */
export const CLAN_PUBLIC_ROLE_WINDOW_DAYS = 30;

export function mskTodayYmd(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function shiftYmd(ymd: string, deltaDays: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/**
 * Последние N суток МСК, включительно.
 * Завтра самый старый день выпадает и на его место встаёт новый.
 */
export function rollingDaysWindow(
  days: number,
  now = new Date()
): { from: string; to: string; days: number } {
  const n = Math.max(1, Math.floor(days));
  const to = mskTodayYmd(now);
  const from = shiftYmd(to, -(n - 1));
  return { from, to, days: n };
}

/**
 * Последние 14 суток МСК, включительно.
 * Завтра самый старый день выпадает и на его место встаёт новый.
 */
export function rollingMainRoleWindow(now = new Date()): {
  from: string;
  to: string;
} {
  const { from, to } = rollingDaysWindow(MAIN_ROLE_WINDOW_DAYS, now);
  return { from, to };
}

export function rollingClanPublicRoleWindow(now = new Date()): {
  from: string;
  to: string;
  days: number;
} {
  return rollingDaysWindow(CLAN_PUBLIC_ROLE_WINDOW_DAYS, now);
}
