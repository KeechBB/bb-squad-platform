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
};

export function HomePanels({ pwrBoard, publicTop }: Props) {
  return (
    <div className="home-dock home-dock-two" aria-label="Сводки главной">
      <section className="home-dock-col is-train">
        <header>Топ 10 Тренировки</header>
        <div className="home-dock-body">
          <HomeTrainPwrTop initial={pwrBoard} />
        </div>
      </section>

      <section className="home-dock-col is-public">
        <header>Топ 10 паблика</header>
        <div className="home-dock-body">
          <PublicTop rows={publicTop} />
        </div>
      </section>
    </div>
  );
}

function PublicTop({ rows }: { rows: HomePublicTopRow[] }) {
  return (
    <div className="home-attend-streaks home-train-pwr" aria-label="Топ паблика">
      {rows.length === 0 ? (
        <p className="home-dock-empty muted">Пока нет статы</p>
      ) : (
        <ol className="home-attend-streaks-list home-train-pwr-list">
          {rows.map((r, i) => (
            <li
              key={r.nick}
              className={`home-attend-streaks-row home-train-pwr-row${i === 0 ? " is-top1" : ""}`}
            >
              <span className="home-attend-streaks-rank">{i + 1}</span>
              <span
                className={`home-pwr-badge rank-${r.rankKey}`}
                title={r.rankLabel}
              >
                {r.rankLabel}
              </span>
              <Link
                className={`home-attend-streaks-nick${i === 0 ? " home-pwr-nick-top1" : ""}`}
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
          ))}
        </ol>
      )}
    </div>
  );
}
