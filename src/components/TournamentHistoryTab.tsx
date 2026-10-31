"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  TOURNAMENT_CUP_CATALOG,
  type HubPlace,
  type TournamentCupRecord,
  type TournamentHubState,
} from "@/lib/tournamentHubShared";
import { formatTourDay } from "@/lib/tournaments";
import type { FruitLiveState } from "@/lib/fruitStrikeLiveView";

function placesFromLiveClient(live: FruitLiveState | null): HubPlace[] {
  const gf = live?.matches?.gf;
  if (!gf || gf.status !== "done" || (!gf.winner?.tag && !gf.winner?.name)) {
    return [];
  }
  const out: HubPlace[] = [];
  if (gf.winner) {
    out.push({
      place: 1,
      tag: gf.winner.tag || gf.winner.name,
      name: gf.winner.name || gf.winner.tag,
      logoUrl: null,
    });
  }
  if (gf.loser) {
    out.push({
      place: 2,
      tag: gf.loser.tag || gf.loser.name,
      name: gf.loser.name || gf.loser.tag,
      logoUrl: null,
    });
  }
  const lf = live?.matches?.lf;
  if (lf?.status === "done" && lf.loser) {
    const tag = lf.loser.tag || lf.loser.name;
    if (
      tag &&
      !out.some((p) => p.tag.toUpperCase() === String(tag).toUpperCase())
    ) {
      out.push({
        place: 3,
        tag,
        name: lf.loser.name || tag,
        logoUrl: null,
      });
    }
  }
  return out;
}

export function TournamentHistoryTab({ hub }: { hub: TournamentHubState }) {
  const cups = hub.historyCups.length
    ? hub.historyCups
    : TOURNAMENT_CUP_CATALOG;
  const [cupId, setCupId] = useState(cups[0]?.id || "");
  const [live, setLive] = useState<FruitLiveState | null>(null);

  const cup: TournamentCupRecord | null =
    cups.find((c) => c.id === cupId) || cups[0] || null;

  useEffect(() => {
    if (!cups.length) return;
    if (!cups.some((c) => c.id === cupId)) setCupId(cups[0].id);
  }, [cups, cupId]);

  useEffect(() => {
    if (!cup) return;
    let cancelled = false;
    (async () => {
      // Пока один live-файл fruit-strike; позже — по cup.id.
      const res = await fetch("/api/tournaments/live", { cache: "no-store" });
      if (!res.ok || cancelled) return;
      const json = (await res.json()) as FruitLiveState;
      if (!cancelled) setLive(json);
    })();
    return () => {
      cancelled = true;
    };
  }, [cup?.id]);

  const places = useMemo(() => {
    if (cup?.id === hub.tournamentId && hub.places.length) return hub.places;
    return placesFromLiveClient(live);
  }, [cup?.id, hub.places, hub.tournamentId, live]);

  const historyRows = live?.history || [];

  if (!cup) {
    return (
      <section className="tn-panel">
        <h2 className="tn-panel-title">История турниров</h2>
        <p className="tn-placeholder">Пока нет завершённых кубков.</p>
      </section>
    );
  }

  return (
    <div className="tn-cup-history">
      <section className="tn-panel tn-cup-picker" aria-label="Выбор турнира">
        <h2 className="tn-panel-title">История турниров</h2>
        <div className="tn-cup-list" role="list">
          {cups.map((c) => (
            <button
              key={c.id}
              type="button"
              role="listitem"
              className={`tn-cup-chip${c.id === cup.id ? " is-on" : ""}`}
              onClick={() => setCupId(c.id)}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={c.logoSrc} alt="" width={40} height={40} />
              <span>
                <b>{c.name}</b>
                <small>
                  {formatTourDay(c.playDate)} · {c.format}
                </small>
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="tn-panel" aria-label="Места">
        <div className="tn-announce-head">
          <h2 className="tn-panel-title">Итог · {cup.name}</h2>
          <Link href={cup.bracketHref} className="tn-bracket-btn tn-bracket-btn-inline">
            Полная сетка
          </Link>
        </div>
        {places.length ? (
          <ol className="tn-podium">
            {places.map((p) => (
              <li key={p.place} className={`tn-podium-row place-${p.place}`}>
                <span className="tn-podium-place">{p.place}</span>
                <span className="tn-podium-team">
                  [{p.tag}] {p.name}
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="tn-placeholder">
            Итоговые места появятся после гранд-финала.
          </p>
        )}
      </section>

      <section className="tn-panel tn-cup-bracket" aria-label="Сетка">
        <h2 className="tn-panel-title">Сетка · как шли команды</h2>
        <p className="tn-idle-hint">
          Итоговая сетка двойного выбывания — на отдельной странице кубка.
        </p>
        <Link href={cup.bracketHref} className="tn-bracket-btn">
          ОТКРЫТЬ СЕТКУ
        </Link>
      </section>

      <section className="tn-panel" aria-label="Матчи">
        <h2 className="tn-panel-title">Ход турнира</h2>
        {historyRows.length ? (
          <div className="tn-table-wrap">
            <table className="tn-table">
              <thead>
                <tr>
                  <th>Дата</th>
                  <th>Матч</th>
                  <th>Карта</th>
                  <th>Счёт</th>
                  <th>Победитель</th>
                </tr>
              </thead>
              <tbody>
                {historyRows.map((row) => (
                  <tr key={row.id}>
                    <td>{row.dateLabel}</td>
                    <td>
                      {row.teamA} — {row.teamB}
                    </td>
                    <td>{row.map}</td>
                    <td>{row.score}</td>
                    <td>{row.winner || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="tn-placeholder">Лента матчей пока пуста.</p>
        )}
      </section>
    </div>
  );
}
