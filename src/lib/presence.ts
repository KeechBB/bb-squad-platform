/** Считаем «онлайн на сайте», если heartbeat был не позже этого порога */
export const SITE_ONLINE_MS = 3 * 60 * 1000;

/** Клиент шлёт heartbeat не чаще этого интервала */
export const SITE_HEARTBEAT_MS = 45 * 1000;

/** На сервере не пишем в БД чаще этого (снижает нагрузку) */
export const SITE_HEARTBEAT_WRITE_MS = 40 * 1000;

export function isSiteOnline(
  lastSeenAt: Date | string | null | undefined,
  now = Date.now()
): boolean {
  if (!lastSeenAt) return false;
  const t =
    typeof lastSeenAt === "string"
      ? Date.parse(lastSeenAt)
      : lastSeenAt.getTime();
  if (!Number.isFinite(t)) return false;
  return now - t <= SITE_ONLINE_MS;
}
