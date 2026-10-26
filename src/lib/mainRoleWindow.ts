/** Сколько суток МСК входит в основную роль. */
export const MAIN_ROLE_WINDOW_DAYS = 14;

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
 * Последние 14 суток МСК, включительно.
 * Завтра самый старый день выпадает и на его место встаёт новый.
 */
export function rollingMainRoleWindow(now = new Date()): {
  from: string;
  to: string;
} {
  const to = mskTodayYmd(now);
  const from = shiftYmd(to, -(MAIN_ROLE_WINDOW_DAYS - 1));
  return { from, to };
}
