"use client";

import { useMemo, useState } from "react";
import {
  TOURNAMENT_TEAM_RATING_DRAFT,
  type TournamentTeamRatingRow,
  type TournamentTeamRatingSortKey,
} from "@/lib/tournaments";

type SortDir = "asc" | "desc";

const COLS: {
  key: TournamentTeamRatingSortKey | "rank" | "logo";
  label: string;
  sortable?: boolean;
  left?: boolean;
}[] = [
  { key: "rank", label: "№" },
  { key: "logo", label: "Лого" },
  { key: "name", label: "Команда", sortable: true, left: true },
  { key: "tag", label: "Тег", sortable: true },
  { key: "matches", label: "Матчи", sortable: true },
  { key: "winPct", label: "% побед", sortable: true },
  { key: "avgKd", label: "Ср. KD", sortable: true },
  { key: "tournamentsPlayed", label: "Турниры", sortable: true },
  { key: "titles", label: "Титулы", sortable: true },
];

function cmp(
  a: TournamentTeamRatingRow,
  b: TournamentTeamRatingRow,
  key: TournamentTeamRatingSortKey,
  dir: SortDir
): number {
  const mul = dir === "asc" ? 1 : -1;
  if (key === "name" || key === "tag") {
    return (
      mul *
      a[key].localeCompare(b[key], "ru", { sensitivity: "base" })
    );
  }
  const av = a[key];
  const bv = b[key];
  if (av === bv) return a.name.localeCompare(b.name, "ru");
  return mul * (av < bv ? -1 : 1);
}

export function TournamentTeamRatingTab() {
  const [rows] = useState<TournamentTeamRatingRow[]>(
    () => [...TOURNAMENT_TEAM_RATING_DRAFT]
  );
  const [sortKey, setSortKey] =
    useState<TournamentTeamRatingSortKey>("titles");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const sorted = useMemo(() => {
    const out = [...rows];
    out.sort((a, b) => cmp(a, b, sortKey, sortDir));
    return out;
  }, [rows, sortKey, sortDir]);

  function onSort(key: TournamentTeamRatingSortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDir(key === "name" || key === "tag" ? "asc" : "desc");
  }

  return (
    <section className="tn-panel tn-pstats tn-trating" aria-label="Рейтинг команд">
      <div className="tn-pstats-head">
        <h2 className="tn-panel-title">Рейтинг команд</h2>
        <p className="tn-pstats-hint">
          Сводка по турнирным командам. «Турниры» — сколько раз участвовали,
          «Титулы» — сколько раз взяли 1 место. № следует за сортировкой.
        </p>
      </div>

      <div className="tn-teams-table-scroll tn-pstats-scroll">
        <table className="tn-teams-table tn-pstats-table tn-trating-table">
          <thead>
            <tr>
              {COLS.map((c) => {
                if (c.key === "rank" || c.key === "logo") {
                  return (
                    <th
                      key={c.key}
                      className={c.left ? "is-nick" : "ctr"}
                    >
                      {c.label}
                    </th>
                  );
                }
                const active = sortKey === c.key;
                return (
                  <th
                    key={c.key}
                    className={`${c.left ? "is-nick" : "ctr"}${active ? " is-sorted" : ""}`}
                  >
                    {c.sortable ? (
                      <button
                        type="button"
                        className="tn-pstats-th-btn"
                        onClick={() => onSort(c.key)}
                        aria-pressed={active}
                      >
                        {c.label}
                        {active ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
                      </button>
                    ) : (
                      c.label
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={COLS.length} className="tn-pstats-empty">
                  Команд в рейтинге пока нет — таблица и сортировка готовы,
                  строки появятся после первых турнирных матчей.
                </td>
              </tr>
            ) : (
              sorted.map((r, i) => (
                <tr key={r.id}>
                  <td className="ctr">{i + 1}</td>
                  <td className="ctr">
                    {r.logoSrc ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        className="tn-trating-logo"
                        src={r.logoSrc}
                        alt=""
                        width={40}
                        height={40}
                      />
                    ) : (
                      <span
                        className="tn-teams-table-logo is-empty"
                        aria-hidden
                      />
                    )}
                  </td>
                  <td className="is-nick">{r.name}</td>
                  <td className="ctr tn-teams-tag">[{r.tag}]</td>
                  <td className="ctr">{r.matches}</td>
                  <td className="ctr">{Math.round(r.winPct)}%</td>
                  <td className="ctr">
                    {Number.isFinite(r.avgKd) ? r.avgKd.toFixed(2) : "—"}
                  </td>
                  <td className="ctr">{r.tournamentsPlayed}</td>
                  <td className="ctr tn-trating-titles">{r.titles}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
