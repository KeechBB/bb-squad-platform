"use client";

import { useEffect, useState } from "react";
import {
  ProfileMatchStatsModal,
  type MatchStatsOpen,
} from "@/components/ProfileMatchStatsModal";
import type { FruitLiveMatch, FruitLiveState } from "@/lib/fruitStrikeLiveView";
import { shortMapName } from "@/lib/shortMapName";

const ORDER = ["q1", "q2", "q3", "q4", "s1", "s2", "l1", "l2", "wf", "r1", "r2", "ls", "lf", "gf"];

function dateLabel(raw: string | undefined): string {
  const day = (raw || "").slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return day || "31.10.2026";
  return `${m[3]}.${m[2]}.${m[1]}`;
}

function tickets(round: { ticketsA?: number; ticketsB?: number } | undefined): string {
  if (!round || round.ticketsA == null || round.ticketsB == null) return "—";
  return `${round.ticketsA}:${round.ticketsB}`;
}

export function TournamentMatchHistoryTab() {
  const [live, setLive] = useState<FruitLiveState | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<MatchStatsOpen | null>(null);

  useEffect(() => {
    let cancelled = false;
    const pull = async () => {
      try {
        const res = await fetch("/api/tournaments/live", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as FruitLiveState;
        if (cancelled) return;
        setLive((prev) => {
          const count = (state: FruitLiveState | null) =>
            ORDER.filter((id) => state?.matches?.[id]?.status === "done").length;
          if (count(data) === 0 && count(prev) > 0) return prev;
          return data;
        });
      } catch {
        /* keep the rows already on screen */
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void pull();
    const timer = window.setInterval(pull, 15000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const rows = ORDER.flatMap((id) => {
    const row = live?.matches?.[id];
    if (!row || row.status !== "done" || !row.teamA || !row.teamB) return [];
    return [{ id, row }];
  });

  function openRow(id: string, row: FruitLiveMatch) {
    const r1 = tickets(row.r1);
    const r2 = tickets(row.r2);
    const map = shortMapName(row.map);
    setOpen({
      kind: "cw",
      matchId: `tn-${id}`,
      title: `${row.teamA?.name} — ${row.teamB?.name}`,
      sub: [map, row.scoreLabel || `${row.sumA}:${row.sumB}`, row.winner?.name ? `победа ${row.winner.name}` : ""]
        .filter(Boolean)
        .join(" · "),
      playersUrl: `/api/tournaments/match/${id}`,
      clan: row.teamA?.tag,
      opp: row.teamB?.tag,
      r1Label: "Раунд 1",
      r2Label: "Раунд 2",
      r1Tickets: r1,
      r2Tickets: r2,
    });
  }

  return (
    <section className="tn-panel tn-pstats tn-mh" aria-label="История матчей">
      <div className="tn-pstats-head">
        <h2 className="tn-panel-title">История матчей</h2>
        <p className="tn-pstats-hint">
          Как в клановых войнах: дата, команды, карта, счёт и итог. Нажми
          строку — откроется статистика обоих раундов.
        </p>
      </div>

      <div className="tn-teams-table-scroll tn-pstats-scroll">
        <table className="tn-teams-table tn-pstats-table tn-mh-table">
          <thead>
            <tr>
              <th>Дата</th>
              <th className="is-nick">Команда A</th>
              <th className="is-nick">Команда B</th>
              <th className="ctr">Карта</th>
              <th className="ctr">Счёт</th>
              <th className="ctr">Итог</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="tn-pstats-empty">
                  Загрузка…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="tn-pstats-empty">
                  Матчей пока нет — таблица как у КВ, ждём первые игры
                  турнира.
                </td>
              </tr>
            ) : (
              rows.map(({ id, row }) => (
                <tr
                  key={id}
                  className="profile-hist-row-click"
                  tabIndex={0}
                  onClick={() => openRow(id, row)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      openRow(id, row);
                    }
                  }}
                >
                  <td>{dateLabel(row.r2?.end || row.r1?.end)}</td>
                  <td className="is-nick">{row.teamA?.name}</td>
                  <td className="is-nick">{row.teamB?.name}</td>
                  <td className="ctr">{shortMapName(row.map)}</td>
                  <td className="ctr tn-mh-score">{row.scoreLabel || "—"}</td>
                  <td className="ctr tn-mh-win">{row.winner?.name || "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <ProfileMatchStatsModal open={open} onClose={() => setOpen(null)} />
    </section>
  );
}
