"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { HomeTrainPwrTop } from "@/components/HomeTrainPwrTop";
import { useAutoRefresh } from "@/hooks/useAutoRefresh";
import type { HomeTrainPwrBoard } from "@/lib/homeTrainPwr";

export type HomePublicTopRow = {
  nick: string;
  rp: number;
  rankLabel: string;
  rankKey: string;
  games?: number;
  place?: number;
};

type Props = {
  pwrBoard: HomeTrainPwrBoard;
  publicTop: HomePublicTopRow[];
  viewerNick?: string | null;
};

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

function gamesTone(games: number) {
  if (games >= 10) return "is-good";
  if (games >= 5) return "is-warn";
  if (games > 0) return "is-bad";
  return "";
}

export function HomePanels({ pwrBoard, publicTop, viewerNick = null }: Props) {
  return (
    <div className="home-dock home-dock-two" aria-label="Сводки главной">
      <section className="home-dock-col is-train">
        <header>
          Топ 10 Тренировки
          <span className="home-dock-live" aria-hidden="true">
            live
          </span>
        </header>
        <div className="home-dock-body">
          <HomeTrainPwrTop initial={pwrBoard} viewerNick={viewerNick} />
        </div>
      </section>

      <section className="home-dock-col is-public">
        <header>
          Топ 10 паблика
          <span className="home-dock-live" aria-hidden="true">
            live
          </span>
        </header>
        <div className="home-dock-body">
          <PublicTop initial={publicTop} viewerNick={viewerNick} />
        </div>
      </section>
    </div>
  );
}

function PublicTop({
  initial,
  viewerNick,
}: {
  initial: HomePublicTopRow[];
  viewerNick?: string | null;
}) {
  const [rows, setRows] = useState(initial);
  const [pulse, setPulse] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/home-public-top", { cache: "no-store" });
      if (!res.ok) return;
      const next = (await res.json()) as { rows?: HomePublicTopRow[] };
      setRows(next.rows || []);
      setPulse(true);
      window.setTimeout(() => setPulse(false), 700);
    } catch {
      /* keep */
    }
  }, []);

  useAutoRefresh(refresh, { intervalMs: 120_000 });

  useEffect(() => {
    setRows(initial);
  }, [initial]);

  const meNote = useMemo(() => {
    if (!viewerNick || !rows.length) return null;
    const me = rows.find((r) => isViewer(r.nick, viewerNick));
    if (!me) return null;
    const lead = rows[0];
    const gap = Math.round((lead?.rp || 0) - (me.rp || 0));
    const place = me.place || rows.indexOf(me) + 1;
    let tone = "is-warn";
    if (place <= 3) tone = "is-good";
    else if (place >= 8) tone = "is-bad";
    return { place, gap, tone, leadNick: lead?.nick || "" };
  }, [rows, viewerNick]);

  return (
    <div
      className={`home-attend-streaks home-train-pwr${
        pulse ? " home-attend-streaks-pulse" : ""
      }`}
      aria-label="Топ паблика"
    >
      <div className="home-attend-streaks-head">
        <p className="home-attend-streaks-title">Ранг · ТОП 10</p>
        <p className="home-attend-streaks-sub muted">
          RP паблика · обновляется само
        </p>
      </div>
      {rows.length === 0 ? (
        <p className="home-dock-empty muted">Пока нет статы</p>
      ) : (
        <ol className="home-attend-streaks-list home-train-pwr-list">
          {rows.map((r, i) => {
            const place = r.place || i + 1;
            const me = isViewer(r.nick, viewerNick);
            const games = Number(r.games) || 0;
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
                  className={`home-attend-streaks-rank${
                    place <= 3 ? " is-medal" : ""
                  }`}
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
                  prefetch={false}
                >
                  {r.nick}
                </Link>
                {games > 0 ? (
                  <span
                    className={`home-dock-games ${gamesTone(games)}`}
                    title="Матчей в сезоне"
                  >
                    {games}
                  </span>
                ) : null}
                <span className="home-attend-streaks-days home-train-pwr-score">
                  <b>{Math.round(Number(r.rp) || 0)}</b>
                  <span>RP</span>
                </span>
              </li>
            );
          })}
        </ol>
      )}
      {meNote ? (
        <p className={`home-dock-me-note ${meNote.tone}`}>
          Ты · #{meNote.place}
          {meNote.gap > 0 ? ` · −${meNote.gap} RP до #1` : " · лидер"}
        </p>
      ) : null}
    </div>
  );
}
