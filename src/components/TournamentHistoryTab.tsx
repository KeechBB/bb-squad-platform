"use client";

import Link from "next/link";
import {
  TOURNAMENT_CUP_CATALOG,
  type TournamentHubState,
} from "@/lib/tournamentHubShared";
import { formatTourDay } from "@/lib/tournaments";

export function TournamentHistoryTab({ hub }: { hub: TournamentHubState }) {
  const cups = hub.historyCups.length
    ? hub.historyCups
    : TOURNAMENT_CUP_CATALOG;

  if (!cups.length) {
    return (
      <section className="tn-panel">
        <h2 className="tn-panel-title">История турниров</h2>
        <p className="tn-placeholder">Пока нет завершённых кубков.</p>
      </section>
    );
  }

  return (
    <section className="tn-panel tn-cup-history" aria-label="История турниров">
      <h2 className="tn-panel-title">История турниров</h2>
      <p className="tn-idle-hint">Нажми на турнир — откроется итоговая сетка.</p>
      <ul className="tn-cup-list">
        {cups.map((cup) => {
          const winner =
            cup.winnerLabel ||
            (cup.id === hub.tournamentId && hub.champion
              ? `[${hub.champion.tag}] ${hub.champion.name}`
              : null);
          return (
            <li key={cup.id}>
              <Link href={cup.bracketHref} className="tn-cup-row">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={cup.logoSrc} alt="" width={48} height={48} />
                <span className="tn-cup-row-main">
                  <b>{cup.name}</b>
                  <small>Дата: {formatTourDay(cup.playDate)}</small>
                </span>
                <span className="tn-cup-row-winner">
                  <em>Победитель</em>
                  <strong>{winner || "—"}</strong>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
