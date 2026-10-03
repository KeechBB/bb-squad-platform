import type { CareerEvent, PlayerCareerFeed } from "@/lib/playerCareerFeed";

type Props = {
  feed: PlayerCareerFeed;
  /** Own profile title */
  self?: boolean;
};

function toneClass(tone: CareerEvent["tone"]): string {
  switch (tone) {
    case "up":
      return "is-up";
    case "down":
      return "is-down";
    case "almost":
      return "is-almost";
    case "warn":
      return "is-warn";
    case "mvp":
      return "is-mvp";
    case "best":
      return "is-best";
    case "good":
      return "is-good";
    case "rp":
      return "is-rp";
    default:
      return "is-note";
  }
}

export function ProfileCareerCard({ feed, self = false }: Props) {
  const events = feed.events || [];
  return (
    <section className="card profile-career-card" aria-label="Карьера">
      <header className="profile-kv-head">
        <h2>{self ? "Моя карьера" : "Карьера"}</h2>
        <span className="profile-career-count">{events.length || "—"}</span>
      </header>

      {events.length === 0 ? (
        <p className="muted profile-career-empty">
          Пока пусто — появятся переводы, MVP, лучшие катки КВ/паблика и ранги
          RP.
        </p>
      ) : (
        <ul className="profile-career-list">
          {events.map((e) => (
            <li key={e.id} className={`profile-career-item ${toneClass(e.tone)}`}>
              <div className="profile-career-item-top">
                <strong>{e.title}</strong>
                <time dateTime={e.at}>{e.atLabel}</time>
              </div>
              {e.body ? <p>{e.body}</p> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
