"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useAutoRefresh } from "@/hooks/useAutoRefresh";
import type { HomeTrainPwrBoard } from "@/lib/homeTrainPwr";

type Props = {
  initial: HomeTrainPwrBoard;
  viewerNick?: string | null;
};

function emptyBoard(): HomeTrainPwrBoard {
  return {
    top10: [],
    players: 0,
    matches: 0,
    updatedAt: new Date().toISOString(),
  };
}

function podiumClass(place: number) {
  if (place === 1) return "is-podium is-gold";
  if (place === 2) return "is-podium is-silver";
  if (place === 3) return "is-podium is-bronze";
  return "";
}

function isViewer(nick: string, viewerNick?: string | null) {
  if (!viewerNick) return false;
  return nick.trim().toLowerCase() === viewerNick.trim().toLowerCase();
}

export function HomeTrainPwrTop({ initial, viewerNick = null }: Props) {
  const [data, setData] = useState<HomeTrainPwrBoard>(initial || emptyBoard());
  const [pulse, setPulse] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/home-train-pwr", { cache: "no-store" });
      if (!res.ok) return;
      const next = (await res.json()) as HomeTrainPwrBoard;
      setData(next);
      setPulse(true);
      window.setTimeout(() => setPulse(false), 700);
    } catch {
      /* keep previous */
    }
  }, []);

  useAutoRefresh(refresh, { intervalMs: 120_000 });

  useEffect(() => {
    setData(initial || emptyBoard());
  }, [initial]);

  const rows = data.top10 || [];

  return (
    <div
      className={`home-attend-streaks home-train-pwr${pulse ? " home-attend-streaks-pulse" : ""}`}
      aria-label="Топ игроков по RP на тренировках"
    >
      <div className="home-attend-streaks-head">
        <p className="home-attend-streaks-title">Ранг · ТОП 10</p>
        <p className="home-attend-streaks-sub muted">
          RP тренировок · обновляется само
        </p>
      </div>
      {rows.length === 0 ? (
        <p className="home-attend-streaks-empty muted">Пока нет статы</p>
      ) : (
        <ol className="home-attend-streaks-list home-train-pwr-list">
          {rows.map((r, i) => {
            const place = i + 1;
            const rp = Math.round(Number(r.rp ?? r.pwr) || 0);
            const me = isViewer(r.nick, viewerNick);
            return (
              <li
                key={r.nick}
                className={[
                  "home-attend-streaks-row",
                  "home-train-pwr-row",
                  podiumClass(place),
                  me ? "is-me" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                <span
                  className={`home-attend-streaks-rank${place <= 3 ? " is-medal" : ""}`}
                  aria-label={`${place} место`}
                >
                  {place <= 3 ? (
                    <span className={`home-podium-medal place-${place}`} />
                  ) : (
                    place
                  )}
                </span>
                <span
                  className={`home-pwr-badge rank-${r.rankKey}`}
                  title={r.rankLabel}
                >
                  {r.rankLabel}
                </span>
                <Link
                  className="home-attend-streaks-nick"
                  href={`/players/${encodeURIComponent(r.nick)}`}
                  title={r.nick}
                >
                  {r.nick}
                </Link>
                <span className="home-attend-streaks-days home-train-pwr-score">
                  <b>{rp}</b>
                  <span>RP</span>
                </span>
              </li>
            );
          })}
        </ol>
      )}
      <p className="home-train-pwr-foot muted">
        <Link href="/tm#/tm/rating">Полный рейтинг →</Link>
      </p>
    </div>
  );
}
