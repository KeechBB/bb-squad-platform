"use client";

import { useState } from "react";
import {
  TOURNAMENT_MATCH_HISTORY_DRAFT,
  type TournamentMatchHistoryRow,
} from "@/lib/tournaments";

function resultLabel(r: TournamentMatchHistoryRow["result"]): string {
  if (r === "win") return "победа";
  if (r === "lose") return "поражение";
  if (r === "pending") return "ожидание";
  return String(r || "—");
}

function resultCls(r: TournamentMatchHistoryRow["result"]): string {
  if (r === "win") return "tn-mh-win";
  if (r === "lose") return "tn-mh-lose";
  return "tn-mh-pending";
}

export function TournamentMatchHistoryTab() {
  const [rows] = useState(() => [...TOURNAMENT_MATCH_HISTORY_DRAFT]);

  return (
    <section className="tn-panel tn-pstats tn-mh" aria-label="История матчей">
      <div className="tn-pstats-head">
        <h2 className="tn-panel-title">История матчей</h2>
        <p className="tn-pstats-hint">
          Как в клановых войнах: дата, команды, карта, счёт и итог. Строки
          появятся после оцифровки турнирных матчей.
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
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="tn-pstats-empty">
                  Матчей пока нет — таблица как у КВ, ждём первые игры
                  турнира.
                </td>
              </tr>
            ) : (
              rows.map((m) => (
                <tr key={m.id}>
                  <td>{m.dateLabel}</td>
                  <td className="is-nick">{m.teamA}</td>
                  <td className="is-nick">{m.teamB}</td>
                  <td className="ctr">{m.map}</td>
                  <td className="ctr tn-mh-score">{m.score}</td>
                  <td className={`ctr ${resultCls(m.result)}`}>
                    {resultLabel(m.result)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
