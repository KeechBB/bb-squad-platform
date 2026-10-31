"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  type TournamentPlayerStatRow,
  type TournamentPlayerStatSortKey,
} from "@/lib/tournaments";

type SortDir = "asc" | "desc";

const COLS: {
  key: TournamentPlayerStatSortKey | "rank" | "clanTag";
  label: string;
  sortable?: boolean;
  nick?: boolean;
}[] = [
  { key: "rank", label: "№" },
  { key: "nick", label: "Ник", sortable: true, nick: true },
  { key: "clanTag", label: "Клан" },
  { key: "noks", label: "Ноки", sortable: true },
  { key: "kills", label: "Убийства", sortable: true },
  { key: "deaths", label: "Смерти", sortable: true },
  { key: "kd", label: "KD", sortable: true },
  { key: "matches", label: "Матчи", sortable: true },
  { key: "winPct", label: "% побед", sortable: true },
  { key: "vehicles", label: "Техника", sortable: true },
  { key: "mvpKiller", label: "MVP Killer", sortable: true },
  { key: "mvpMedic", label: "MVP Medic", sortable: true },
  { key: "mvpArmor", label: "MVP Armor", sortable: true },
];

function nickKey(raw: string): string {
  return (raw || "")
    .normalize("NFKC")
    .replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF\u{E0000}-\u{E007F}]/gu, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

function zeroRow(
  nick: string,
  clanTag: string | null
): TournamentPlayerStatRow {
  return {
    nick,
    clanTag,
    noks: 0,
    kills: 0,
    deaths: 0,
    kd: 0,
    matches: 0,
    winPct: 0,
    vehicles: 0,
    mvpKiller: 0,
    mvpMedic: 0,
    mvpArmor: 0,
  };
}

function cmp(
  a: TournamentPlayerStatRow,
  b: TournamentPlayerStatRow,
  key: TournamentPlayerStatSortKey,
  dir: SortDir
): number {
  const mul = dir === "asc" ? 1 : -1;
  if (key === "nick") {
    return mul * a.nick.localeCompare(b.nick, "ru", { sensitivity: "base" });
  }
  const av = a[key];
  const bv = b[key];
  if (av === bv) return a.nick.localeCompare(b.nick, "ru");
  return mul * (av < bv ? -1 : 1);
}

function formatKd(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(2);
}

function formatWin(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return `${Math.round(n)}%`;
}

export function TournamentPlayerStatsTab() {
  const [rows, setRows] = useState<TournamentPlayerStatRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] =
    useState<TournamentPlayerStatSortKey>("nick");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [res, liveRes] = await Promise.all([
          fetch("/api/tournaments/teams", { cache: "no-store" }),
          fetch("/api/tournaments/live", { cache: "no-store" }),
        ]);
        const data = (await res.json().catch(() => ({}))) as {
          teams?: {
            members: { nick: string; clanTag: string | null }[];
          }[];
        };
        const live = (await liveRes.json().catch(() => ({}))) as {
          playerStats?: Array<Partial<TournamentPlayerStatRow> & { nick?: string }>;
        };
        if (cancelled || !res.ok) return;
        const byNick = new Map<string, TournamentPlayerStatRow>();
        for (const team of data.teams || []) {
          for (const m of team.members || []) {
            const nick = (m.nick || "").trim();
            if (!nick) continue;
            const key = nickKey(nick);
            if (!byNick.has(key)) {
              byNick.set(key, zeroRow(nick, m.clanTag || null));
            }
          }
        }
        // Log nick → roster nick (Isaiah / Иcaйя, etc.)
        const ALIASES: Record<string, string> = {
          isaiah: nickKey("Иcaйя"),
          исайя: nickKey("Иcaйя"),
          trixx: "trix",
        };
        for (const stat of live.playerStats || []) {
          const nick = (stat.nick || "").trim();
          if (!nick) continue;
          let key = nickKey(nick);
          key = ALIASES[key] || key;
          const row = byNick.get(key) || zeroRow(nick, stat.clanTag || null);
          row.noks = Number(stat.noks) || 0;
          row.kills = Number(stat.kills) || 0;
          row.deaths = Number(stat.deaths) || 0;
          row.kd = Number(stat.kd) || 0;
          row.matches = Number(stat.matches) || 0;
          row.winPct = Number(stat.winPct) || 0;
          row.vehicles = Number(stat.vehicles) || 0;
          row.mvpKiller = Number(stat.mvpKiller) || 0;
          row.mvpMedic = Number(stat.mvpMedic) || 0;
          row.mvpArmor = Number(stat.mvpArmor) || 0;
          byNick.set(key, row);
        }
        setRows([...byNick.values()]);
      } catch {
        if (!cancelled) setRows([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const sorted = useMemo(() => {
    const out = [...rows];
    out.sort((a, b) => cmp(a, b, sortKey, sortDir));
    return out;
  }, [rows, sortKey, sortDir]);

  function onSort(key: TournamentPlayerStatSortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDir(key === "nick" ? "asc" : "desc");
  }

  return (
    <section className="tn-panel tn-pstats" aria-label="Рейтинг игроков">
      <div className="tn-pstats-head">
        <h2 className="tn-panel-title">Рейтинг игроков</h2>
        <p className="tn-pstats-hint">
          По закрытым встречам турнира. По умолчанию — по алфавиту. Клик по
          нику — профиль.
        </p>
      </div>

      <div className="tn-teams-table-scroll tn-pstats-scroll">
        <table className="tn-teams-table tn-pstats-table">
          <thead>
            <tr>
              {COLS.map((c) => {
                if (c.key === "rank" || c.key === "clanTag") {
                  return (
                    <th key={c.key} className={c.nick ? "is-nick" : "ctr"}>
                      {c.label}
                    </th>
                  );
                }
                const active = sortKey === c.key;
                return (
                  <th
                    key={c.key}
                    className={`${c.nick ? "is-nick" : "ctr"}${active ? " is-sorted" : ""}`}
                  >
                    {c.sortable ? (
                      <button
                        type="button"
                        className="tn-pstats-th-btn"
                        onClick={() =>
                          onSort(c.key as TournamentPlayerStatSortKey)
                        }
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
            {loading ? (
              <tr>
                <td colSpan={COLS.length} className="tn-pstats-empty">
                  Загрузка…
                </td>
              </tr>
            ) : sorted.length === 0 ? (
              <tr>
                <td colSpan={COLS.length} className="tn-pstats-empty">
                  Пока никто не зарегистрирован в командах — появятся здесь с
                  нулями.
                </td>
              </tr>
            ) : (
              sorted.map((r, i) => (
                <tr key={r.nick}>
                  <td className="ctr">{i + 1}</td>
                  <td className="is-nick">
                    <Link
                      className="tn-pstats-nick"
                      href={`/players/${encodeURIComponent(r.nick)}`}
                    >
                      {r.nick}
                    </Link>
                  </td>
                  <td className="ctr">{r.clanTag ? `[${r.clanTag}]` : "—"}</td>
                  <td className="ctr">{r.noks}</td>
                  <td className="ctr">{r.kills}</td>
                  <td className="ctr">{r.deaths}</td>
                  <td className="ctr">{formatKd(r.kd)}</td>
                  <td className="ctr">{r.matches}</td>
                  <td className="ctr">{formatWin(r.winPct)}</td>
                  <td className="ctr">{r.vehicles}</td>
                  <td className="ctr col-mvp-killer">{r.mvpKiller}</td>
                  <td className="ctr col-mvp-medic">{r.mvpMedic}</td>
                  <td className="ctr col-mvp-armor">{r.mvpArmor}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
