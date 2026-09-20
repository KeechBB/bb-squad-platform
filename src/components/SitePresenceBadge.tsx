import { isSiteOnline } from "@/lib/presence";

type Props = {
  lastSeenAt?: Date | string | null;
  /** Компактный вариант для списков (точка + «онлайн») */
  compact?: boolean;
};

export function SitePresenceBadge({ lastSeenAt, compact }: Props) {
  const online = isSiteOnline(lastSeenAt);
  if (!online) {
    if (compact) return null;
    return (
      <span className="site-presence site-presence-off" title="Не на сайте">
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
