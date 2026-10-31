"use client";

import { useState } from "react";
import Link from "next/link";
import {
  TOURNAMENT_CUP_CATALOG,
  type TournamentCupRecord,
  type TournamentHubState,
} from "@/lib/tournamentHubShared";
import { formatTourDay } from "@/lib/tournaments";

function winnerFor(
  cup: TournamentCupRecord,
  hub: TournamentHubState
): string | null {
  if (cup.winnerLabel) return cup.winnerLabel;
  if (cup.id === hub.tournamentId && hub.champion) {
    return `[${hub.champion.tag}] ${hub.champion.name}`;
  }
  return null;
}

export function TournamentHistoryTab({ hub }: { hub: TournamentHubState }) {
  const cups = hub.historyCups.length
    ? hub.historyCups
    : TOURNAMENT_CUP_CATALOG;
  const [pendingCupId, setPendingCupId] = useState<string | null>(null);

  if (!cups.length) {
    return (
      <section className="tn-panel">
        <h2 className="tn-panel-title">История турниров</h2>
        <p className="tn-placeholder">Пока нет завершённых кубков.</p>
      </section>
    );
  }

  const pendingCup = pendingCupId
    ? cups.find((c) => c.id === pendingCupId) || null
    : null;

  if (pendingCup) {
    return (
      <section className="tn-panel tn-cup-history" aria-label="История турниров">
        <h2 className="tn-panel-title">История турниров</h2>
        <div className="tn-cup-wait" role="status">
          <p className="tn-cup-wait-eyebrow">{pendingCup.name}</p>
          <p className="tn-cup-wait-title">Дождитесь окончания турнира</p>
          <p className="tn-cup-wait-body">
            Итоговая сетка откроется после гранд-финала, когда будет известен чемпион.
          </p>
          <button
            type="button"
            className="tn-bracket-btn tn-bracket-btn-inline"
            onClick={() => setPendingCupId(null)}
          >
            К списку
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="tn-panel tn-cup-history" aria-label="История турниров">
      <h2 className="tn-panel-title">История турниров</h2>
      <p className="tn-idle-hint">
        Нажми на турнир — откроется итоговая сетка (когда есть чемпион).
      </p>
      <ul className="tn-cup-list">
        {cups.map((cup) => {
          const winner = winnerFor(cup, hub);
          const inner = (
            <>
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
            </>
          );

          if (winner) {
            return (
              <li key={cup.id}>
                <Link href={cup.bracketHref} className="tn-cup-row">
                  {inner}
                </Link>
              </li>
            );
          }

          return (
            <li key={cup.id}>
              <button
                type="button"
                className="tn-cup-row"
                onClick={() => setPendingCupId(cup.id)}
              >
                {inner}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
