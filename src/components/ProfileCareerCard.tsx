"use client";

import { useEffect, useState } from "react";

type CareerTone =
  | "up"
  | "down"
  | "almost"
  | "warn"
  | "mvp"
  | "best"
  | "good"
  | "note"
  | "rp";

type CareerEvent = {
  id: string;
  tone: CareerTone;
  title: string;
  body?: string;
  at: string;
  atLabel: string;
};

type PlayerCareerFeed = {
  nick: string;
  events: CareerEvent[];
  updatedAt: string;
};

type Props = {
  /** SSR seed (optional — usually empty; client fetches after paint) */
  feed?: PlayerCareerFeed | null;
  nick?: string;
  /** Own profile title */
  self?: boolean;
};

function emptyFeed(nick = ""): PlayerCareerFeed {
  return { nick, events: [], updatedAt: new Date().toISOString() };
}

function toneClass(tone: CareerTone): string {
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

export function ProfileCareerCard({
  feed: initial,
  nick,
  self = false,
}: Props) {
  const seedNick = nick || initial?.nick || "";
  const [feed, setFeed] = useState<PlayerCareerFeed>(
    initial && (initial.events?.length || 0) > 0
      ? initial
      : emptyFeed(seedNick)
  );
  const [loading, setLoading] = useState(
    !(initial && (initial.events?.length || 0) > 0) && Boolean(seedNick)
  );

  useEffect(() => {
    if (!seedNick) return;
    if (initial && (initial.events?.length || 0) > 0) return;
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const res = await fetch(
          `/api/career?nick=${encodeURIComponent(seedNick)}`,
          { cache: "no-store" }
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as PlayerCareerFeed;
        if (!cancelled) setFeed(data);
      } catch {
        if (!cancelled) setFeed(emptyFeed(seedNick));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [seedNick, initial]);

  const events = feed.events || [];
  return (
    <section className="card profile-career-card" aria-label="Карьера">
      <header className="profile-kv-head">
        <h2>{self ? "Моя карьера" : "Карьера"}</h2>
        <span className="profile-career-count">
          {loading ? "…" : events.length || "—"}
        </span>
      </header>

      {loading && events.length === 0 ? (
        <p className="muted profile-career-empty">Загрузка…</p>
      ) : events.length === 0 ? (
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
