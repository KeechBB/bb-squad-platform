import { isSiteOnline } from "@/lib/presence";

type Props = {
  lastSeenAt?: Date | string | null;
  /** Компактный вариант для списков */
  compact?: boolean;
  /** В compact по умолчанию офлайн скрыт; true — показывать «офлайн» */
  showOffline?: boolean;
};

export function SitePresenceBadge({
  lastSeenAt,
  compact,
  showOffline,
}: Props) {
  const online = isSiteOnline(lastSeenAt);
  if (!online) {
    if (compact && !showOffline) return null;
    return (
      <span
        className={`site-presence site-presence-off${compact ? " site-presence-compact site-presence-compact-off" : ""}`}
        title="Не на сайте"
      >
        <span className="site-presence-dot" aria-hidden />
        офлайн
      </span>
    );
  }
  return (
    <span
      className={`site-presence site-presence-on${compact ? " site-presence-compact" : ""}`}
      title="Сейчас на сайте"
    >
      <span className="site-presence-dot" aria-hidden />
      {compact ? "онлайн" : "онлайн на сайте"}
    </span>
  );
}
