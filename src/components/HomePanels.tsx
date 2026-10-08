"use client";

import Link from "next/link";
import { HomeTrainPwrTop } from "@/components/HomeTrainPwrTop";
import type { HomeTrainPwrBoard } from "@/lib/homeTrainPwr";

export type HomePublicTopRow = {
  nick: string;
  rp: number;
  rankLabel: string;
  rankKey: string;
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

export function HomePanels({ pwrBoard, publicTop, viewerNick = null }: Props) {
  return (
    <div className="home-dock home-dock-two" aria-label="Сводки главной">
      <section className="home-dock-col is-train">
        <header>Топ 10 Тренировки</header>
        <div className="home-dock-body">
          <HomeTrainPwrTop initial={pwrBoard} viewerNick={viewerNick} />
        </div>
      </section>

      <section className="home-dock-col is-public">
        <header>Топ 10 паблика</header>
        <div className="home-dock-body">
          <PublicTop rows={publicTop} viewerNick={viewerNick} />
        </div>
      </section>
    </div>
  );
}

function PublicTop({
  rows,
  viewerNick,
}: {
  rows: HomePublicTopRow[];
  viewerNick?: string | null;
}) {
  return (
    <div className="home-attend-streaks home-train-pwr" aria-label="Топ паблика">
      {rows.length === 0 ? (
        <p className="home-dock-empty muted">Пока нет статы</p>
      ) : (
        <ol className="home-attend-streaks-list home-train-pwr-list">
          {rows.map((r, i) => {
            const place = i + 1;
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
                  <b>{Math.round(Number(r.rp) || 0)}</b>
                  <span>RP</span>
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
