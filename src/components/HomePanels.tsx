"use client";

import Link from "next/link";
import { HomeTrainPwrTop } from "@/components/HomeTrainPwrTop";
import {
  formatTierArrow,
  type HomeTierBoardData,
  type HomeTierCandidate,
  type HomeTierTransfer,
} from "@/lib/homeTierBoardUi";
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
  tierBoard: HomeTierBoardData;
};

export function HomePanels({ pwrBoard, publicTop, tierBoard }: Props) {
  const transfers = tierBoard.transfers || [];
  const candidates = tierBoard.candidates || [];

  return (
    <div className="home-dock" aria-label="Сводки главной">
      <section className="home-dock-col is-train">
        <header>Top 10 Тренировки</header>
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

      <section className="home-dock-col is-tiers">
        <header>Тиры</header>
        <div className="home-dock-body home-dock-tiers">
          <div className="home-dock-tier-block">
            <h3>Переводы</h3>
            {transfers.length === 0 ? (
              <p className="home-dock-empty muted">Пока нет</p>
            ) : (
              <ul>
                {transfers.map((row) => (
                  <TransferRow
                    key={`${row.nick}-${row.at}-${row.fromTier}-${row.toTier}`}
                    row={row}
                  />
                ))}
              </ul>
            )}
          </div>
          <div className="home-dock-tier-block">
            <h3>Кандидаты</h3>
            {candidates.length === 0 ? (
              <p className="home-dock-empty muted">Пока нет</p>
            ) : (
              <ul>
                {candidates.map((row) => (
                  <CandidateRow
                    key={`${row.nick}-${row.dir}-${row.toTier}-${row.band}`}
                    row={row}
                  />
                ))}
              </ul>
            )}
          </div>
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
              <span className={`home-pwr-badge rank-${r.rankKey}`} title={r.rankLabel}>
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
      <p className="home-train-pwr-foot muted">
        <Link href="/public">Полный рейтинг →</Link>
      </p>
    </div>
  );
}

function TransferRow({ row }: { row: HomeTierTransfer }) {
  const tone = row.dir === "up" ? "is-up" : "is-down";
  return (
    <li className={`home-dock-tier-row ${tone}`}>
      <Link href={`/players/${encodeURIComponent(row.nick)}`} title={row.nick}>
        {row.nick}
      </Link>
      <span>{formatTierArrow(row.fromTier, row.toTier)}</span>
    </li>
  );
}

function CandidateRow({ row }: { row: HomeTierCandidate }) {
  const tone = row.dir === "down" ? "is-down" : "is-up";
  return (
    <li className={`home-dock-tier-row ${tone}`}>
      <Link href={`/players/${encodeURIComponent(row.nick)}`} title={row.nick}>
        {row.nick}
      </Link>
      <span>
        {formatTierArrow(row.fromTier, row.toTier)}
        <b>{row.fit.toFixed(0)}%</b>
      </span>
    </li>
  );
}
