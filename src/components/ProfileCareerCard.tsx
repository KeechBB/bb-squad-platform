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
  | "rp"
  | "bp"
  | "bp_level"
  | "bp_reward"
  | "win"
  | "loss"
  | "record";

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
  windowDays?: number;
};

type Props = {
  /** SSR seed (optional — usually empty; client fetches after paint) */
  feed?: PlayerCareerFeed | null;
  nick?: string;
  /** Own profile title */
  self?: boolean;
  /** Внутри вкладки «Моя карьера» — без своего заголовка */
  embedded?: boolean;
};

function emptyFeed(nick = ""): PlayerCareerFeed {
  return { nick, events: [], updatedAt: new Date().toISOString(), windowDays: 7 };
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
    case "record":
      return "is-record";
    case "good":
      return "is-good";
    case "rp":
      return "is-rp";
    case "bp":
      return "is-bp";
    case "bp_level":
      return "is-bp-level";
    case "bp_reward":
      return "is-bp-reward";
    case "win":
      return "is-win";
    case "loss":
      return "is-loss";
    default:
      return "is-note";
  }
}

function toneBadge(tone: CareerTone): string {
  switch (tone) {
    case "up":
      return "тир ↑";
    case "down":
      return "тир ↓";
    case "almost":
      return "кандидат";
    case "warn":
      return "риск";
    case "mvp":
      return "MVP";
    case "best":
    case "record":
      return "рекорд";
    case "good":
      return "игра";
    case "rp":
      return "ранг";
    case "bp":
      return "BP";
    case "bp_level":
      return "BP ур.";
    case "bp_reward":
      return "награда";
    case "win":
      return "победа";
    case "loss":
      return "пораж.";
    default:
      return "событие";
  }
}

export function ProfileCareerCard({
  feed: initial,
  nick,
  self = false,
  embedded = false,
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
  const windowDays = feed.windowDays ?? 7;

  return (
    <section
      className={`card profile-career-card${embedded ? " is-embedded" : ""}`}
      aria-label="Карьера"
    >
      {embedded ? null : (
        <header className="profile-kv-head">
          <h2>{self ? "Моя карьера" : "Карьера"}</h2>
          <span className="profile-career-count">
            {loading ? "…" : events.length || "—"}
          </span>
        </header>
      )}

      {loading && events.length === 0 ? (
        <p className="muted profile-career-empty">Загрузка…</p>
      ) : events.length === 0 ? (
        <p className="muted profile-career-empty">
          За последние {windowDays} дней пока пусто — появятся катки, MVP,
          рекорды, переводы и прогресс Battle Pass.
        </p>
      ) : (
        <ul className="profile-career-list">
          {events.map((e) => (
            <li key={e.id} className={`profile-career-item ${toneClass(e.tone)}`}>
              <div className="profile-career-item-top">
                <span className="profile-career-badge" aria-hidden>
                  {toneBadge(e.tone)}
                </span>
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
