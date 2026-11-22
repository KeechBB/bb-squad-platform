"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  ClanPublicMapRow,
  ClanPublicPlayerRow,
  ClanPublicRoleSlice,
  ClanPublicStats,
} from "@/lib/clanPublicStats";

type StatsLane = "public" | "cw" | "train";

type Props = {
  clanId: string;
};

const PAGE = 12;

const ROLE_COLORS = [
  "#a78bfa",
  "#34d399",
  "#fbbf24",
  "#f472b6",
  "#60a5fa",
  "#fb923c",
  "#2dd4bf",
  "#e879f9",
  "#94a3b8",
  "#f87171",
];

type PlayerSortKey =
  | "nick"
  | "nok"
  | "kills"
  | "deaths"
  | "res"
  | "kd"
  | "winPct";

type MapSortKey = "map" | "winPct" | "games";

function WipModal({
  title,
  onClose,
}: {
  title: string;
  onClose: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="clan-stats-wip-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="clan-stats-wip-title"
      onClick={onClose}
    >
      <div
        className="clan-stats-wip-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="clan-stats-wip-title">{title}</h3>
        <p>В разработке</p>
        <button type="button" className="btn primary" onClick={onClose}>
          ОК
        </button>
      </div>
    </div>
  );
}

function RoleDonut({
  roles,
  active,
  onHover,
  onPick,
}: {
  roles: ClanPublicRoleSlice[];
  active: string | null;
  onHover: (kit: string | null) => void;
  onPick: (kit: string) => void;
}) {
  const size = 220;
  const cx = size / 2;
  const cy = size / 2;
  const rOut = 92;
  const rIn = 54;
  const total = roles.reduce((a, r) => a + Math.max(r.hours, 0.001), 0) || 1;

  let angle = -Math.PI / 2;
  const slices = roles.map((role, i) => {
    const frac = Math.max(role.hours, 0.001) / total;
    const sweep = frac * Math.PI * 2;
    const a0 = angle;
    const a1 = angle + sweep;
    angle = a1;
    const large = sweep > Math.PI ? 1 : 0;
    const x0 = cx + rOut * Math.cos(a0);
    const y0 = cy + rOut * Math.sin(a0);
    const x1 = cx + rOut * Math.cos(a1);
    const y1 = cy + rOut * Math.sin(a1);
    const xi0 = cx + rIn * Math.cos(a1);
    const yi0 = cy + rIn * Math.sin(a1);
    const xi1 = cx + rIn * Math.cos(a0);
    const yi1 = cy + rIn * Math.sin(a0);
    const d = [
      `M ${x0} ${y0}`,
      `A ${rOut} ${rOut} 0 ${large} 1 ${x1} ${y1}`,
      `L ${xi0} ${yi0}`,
      `A ${rIn} ${rIn} 0 ${large} 0 ${xi1} ${yi1}`,
      "Z",
    ].join(" ");
    return { role, d, color: ROLE_COLORS[i % ROLE_COLORS.length] };
  });

  const activeRole = roles.find((r) => r.kit === active) || null;

  return (
    <div className="clan-pub-donut-wrap">
      <svg
        className="clan-pub-donut"
        viewBox={`0 0 ${size} ${size}`}
        width={size}
        height={size}
        role="img"
        aria-label="Диаграмма ролей"
      >
        {slices.length === 0 ? (
          <circle
            cx={cx}
            cy={cy}
            r={rOut}
            fill="none"
            stroke="rgba(167,139,250,0.25)"
            strokeWidth={rOut - rIn}
          />
        ) : (
          slices.map(({ role, d, color }) => (
            <path
              key={role.kit}
              d={d}
              fill={color}
              opacity={active && active !== role.kit ? 0.35 : 1}
              className="clan-pub-donut-slice"
              onMouseEnter={() => onHover(role.kit)}
              onMouseLeave={() => onHover(null)}
              onClick={() => onPick(role.kit)}
            >
              <title>
                {role.kit}: {role.pct}% · {role.players} игр. · {role.hoursLabel}
              </title>
            </path>
          ))
        )}
        <circle cx={cx} cy={cy} r={rIn - 2} fill="rgba(12,10,20,0.92)" />
        <text
          x={cx}
          y={cy - 6}
          textAnchor="middle"
          className="clan-pub-donut-center-title"
        >
          {activeRole ? activeRole.kit : "Роли"}
        </text>
        <text
          x={cx}
          y={cy + 14}
          textAnchor="middle"
          className="clan-pub-donut-center-sub"
        >
          {activeRole
            ? `${activeRole.pct}% · ${activeRole.hoursLabel}`
            : `${roles.length || 0} китов`}
        </text>
      </svg>
    </div>
  );
}

export function ClanPublicStatsPanel({ clanId }: Props) {
  const [lane, setLane] = useState<StatsLane>("public");
  const [wip, setWip] = useState<null | "cw" | "train">(null);
  const [data, setData] = useState<ClanPublicStats | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const [hoverKit, setHoverKit] = useState<string | null>(null);
  const [pickedKit, setPickedKit] = useState<string | null>(null);

  const [pSort, setPSort] = useState<PlayerSortKey>("kills");
  const [pDir, setPDir] = useState<"asc" | "desc">("desc");
  const [pPage, setPPage] = useState(0);

  const [mSort, setMSort] = useState<MapSortKey>("winPct");
  const [mDir, setMDir] = useState<"asc" | "desc">("desc");
  const [mPage, setMPage] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/clans/${clanId}/stats?lane=public`, {
        cache: "no-store",
      });
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        public?: ClanPublicStats;
      };
      if (!res.ok || !json.ok || !json.public) {
        setError(json.error || "Не удалось загрузить");
        setData(null);
        return;
      }
      setData(json.public);
    } catch {
      setError("нет связи");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [clanId]);

  useEffect(() => {
    void load();
  }, [load]);

  function openLane(next: StatsLane) {
    if (next === "cw" || next === "train") {
      setWip(next);
      return;
    }
    setLane("public");
  }

  const picked = useMemo(
    () => data?.roles.find((r) => r.kit === pickedKit) || null,
    [data, pickedKit]
  );

  const playersSorted = useMemo(() => {
    const rows = [...(data?.players || [])];
    const mul = pDir === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      if (pSort === "nick") return mul * a.nick.localeCompare(b.nick, "ru");
      if (pSort === "winPct") {
        const av = a.winPct ?? -1;
        const bv = b.winPct ?? -1;
        return mul * (av - bv);
      }
      return mul * ((a[pSort] as number) - (b[pSort] as number));
    });
    return rows;
  }, [data, pSort, pDir]);

  const mapsSorted = useMemo(() => {
    const rows = [...(data?.maps || [])];
    const mul = mDir === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      if (mSort === "map") return mul * a.map.localeCompare(b.map, "ru");
      return mul * (a[mSort] - b[mSort]);
    });
    return rows;
  }, [data, mSort, mDir]);

  const pPages = Math.max(1, Math.ceil(playersSorted.length / PAGE));
  const mPages = Math.max(1, Math.ceil(mapsSorted.length / PAGE));
  const pSlice = playersSorted.slice(pPage * PAGE, pPage * PAGE + PAGE);
  const mSlice = mapsSorted.slice(mPage * PAGE, mPage * PAGE + PAGE);

  function togglePlayerSort(key: PlayerSortKey) {
    if (pSort === key) setPDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setPSort(key);
      setPDir(key === "nick" ? "asc" : "desc");
    }
    setPPage(0);
  }

  function toggleMapSort(key: MapSortKey) {
    if (mSort === key) setMDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setMSort(key);
      setMDir(key === "map" ? "asc" : "desc");
    }
    setMPage(0);
  }

  const avg = data?.averages;

  return (
    <section className="card clan-pub-stats">
      <div className="clan-pub-lanes">
        {(
          [
            ["public", "паблик"],
            ["cw", "КВ"],
            ["train", "Тренировки"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={`admin-tab${lane === id && !wip ? " active" : ""}`}
            onClick={() => openLane(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {wip ? (
        <WipModal
          title={wip === "cw" ? "КВ" : "Тренировки"}
          onClose={() => setWip(null)}
        />
      ) : null}

      {loading ? <p className="muted">Загрузка паблика…</p> : null}
      {error ? <p className="error">{error}</p> : null}

      {data && !loading ? (
        <>
          <p className="muted clan-pub-window">
            PB1 · роли за {data.windowDays} сут. МСК ({data.from} — {data.to}) ·
            игроков с боем: {data.playersWithCombat}/{data.membersTotal}
          </p>

          <div className="clan-pub-top">
            <div className="clan-pub-roles card-inset">
              <h3 className="stats-h3">Диаграмма ролей</h3>
              <div className="clan-pub-roles-body">
                <RoleDonut
                  roles={data.roles}
                  active={hoverKit || pickedKit}
                  onHover={setHoverKit}
                  onPick={(kit) =>
                    setPickedKit((cur) => (cur === kit ? null : kit))
                  }
                />
                <ul className="clan-pub-role-legend">
                  {data.roles.length === 0 ? (
                    <li className="muted">Нет ролей за окно</li>
                  ) : (
                    data.roles.map((r, i) => (
                      <li key={r.kit}>
                        <button
                          type="button"
                          className={`clan-pub-role-leg${
                            pickedKit === r.kit ? " is-on" : ""
                          }`}
                          onMouseEnter={() => setHoverKit(r.kit)}
                          onMouseLeave={() => setHoverKit(null)}
                          onClick={() =>
                            setPickedKit((cur) => (cur === r.kit ? null : r.kit))
                          }
                        >
                          <span
                            className="clan-pub-swatch"
                            style={{
                              background: ROLE_COLORS[i % ROLE_COLORS.length],
                            }}
                          />
                          <span className="clan-pub-role-name">{r.kit}</span>
                          <span className="muted">
                            {r.pct}% · {r.players}
                          </span>
                        </button>
                      </li>
                    ))
                  )}
                </ul>
              </div>
              {picked ? (
                <div className="clan-pub-role-drill">
                  <header>
                    <strong>{picked.kit}</strong>
                    <span className="muted">
                      {picked.hoursLabel} · {picked.players} игр.
                    </span>
                    <button
                      type="button"
                      className="btn ghost"
                      onClick={() => setPickedKit(null)}
                    >
                      Закрыть
                    </button>
                  </header>
                  <ol>
                    {picked.members.map((m) => (
                      <li key={m.userId}>
                        <span>{m.nick}</span>
                        <span>{m.hoursLabel}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              ) : (
                <p className="muted clan-pub-hint">
                  Наведи на сектор или кликни — список часов по игрокам
                </p>
              )}
            </div>

            <div className="clan-pub-avgs card-inset">
              <h3 className="stats-h3">Средние по клану</h3>
              <div className="clan-pub-avg-grid">
                {(
                  [
                    ["Килов в среднем", avg?.avgKills],
                    ["Уничт. тех в среднем", avg?.avgVehicleKills],
                    ["средний KDA", avg?.avgKd],
                    [
                      "винрейт в среднем",
                      avg?.avgWinrate != null ? `${avg.avgWinrate}%` : "—",
                    ],
                    ["MVP ресы", avg?.mvpMedicTotal],
                    ["Ноков в среднем", avg?.avgNok],
                    ["Ресов в среднем", avg?.avgRes],
                    ["В среднем сессия", avg?.avgSessionLabel],
                    ["смертей в среднем", avg?.avgDeaths],
                    ["всего MVP убийца", avg?.mvpKillerTotal],
                  ] as const
                ).map(([label, value]) => (
                  <div key={label} className="clan-pub-avg-cell">
                    <span>{label}</span>
                    <strong>{value ?? "—"}</strong>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="clan-pub-bottom">
            <div className="clan-pub-players card-inset">
              <h3 className="stats-h3">Статистика игроков</h3>
              <div className="clan-pub-table-wrap">
                <table className="clan-pub-table">
                  <thead>
                    <tr>
                      {(
                        [
                          ["nick", "Ник"],
                          ["nok", "Ноки"],
                          ["kills", "Килы"],
                          ["deaths", "Смерти"],
                          ["res", "Ресы"],
                          ["kd", "KD"],
                          ["winPct", "Win%"],
                        ] as const
                      ).map(([key, label]) => (
                        <th key={key}>
                          <button
                            type="button"
                            className="clan-pub-sort"
                            onClick={() => togglePlayerSort(key)}
                          >
                            {label}
                            {pSort === key ? (pDir === "asc" ? " ↑" : " ↓") : ""}
                          </button>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pSlice.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="muted">
                          Пока нет боёв на PB1
                        </td>
                      </tr>
                    ) : (
                      pSlice.map((r: ClanPublicPlayerRow) => (
                        <tr key={r.nick}>
                          <td>{r.nick}</td>
                          <td>{r.nok}</td>
                          <td>{r.kills}</td>
                          <td>{r.deaths}</td>
                          <td>{r.res}</td>
                          <td>{r.kd}</td>
                          <td>{r.winPct != null ? `${r.winPct}%` : "—"}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              {pPages > 1 ? (
                <div className="clan-pub-pager">
                  <button
                    type="button"
                    className="btn ghost"
                    disabled={pPage <= 0}
                    onClick={() => setPPage((p) => Math.max(0, p - 1))}
                  >
                    ←
                  </button>
                  <span>
                    {pPage + 1}/{pPages}
                  </span>
                  <button
                    type="button"
                    className="btn ghost"
                    disabled={pPage >= pPages - 1}
                    onClick={() =>
                      setPPage((p) => Math.min(pPages - 1, p + 1))
                    }
                  >
                    →
                  </button>
                </div>
              ) : null}
            </div>

            <div className="clan-pub-maps card-inset">
              <h3 className="stats-h3">Карты</h3>
              <div className="clan-pub-table-wrap">
                <table className="clan-pub-table">
                  <thead>
                    <tr>
                      {(
                        [
                          ["map", "Карта"],
                          ["winPct", "% побед"],
                          ["games", "Игр"],
                        ] as const
                      ).map(([key, label]) => (
                        <th key={key}>
                          <button
                            type="button"
                            className="clan-pub-sort"
                            onClick={() => toggleMapSort(key)}
                          >
                            {label}
                            {mSort === key ? (mDir === "asc" ? " ↑" : " ↓") : ""}
                          </button>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {mSlice.length === 0 ? (
                      <tr>
                        <td colSpan={3} className="muted">
                          Нет карт
                        </td>
                      </tr>
                    ) : (
                      mSlice.map((r: ClanPublicMapRow) => (
                        <tr key={r.map}>
                          <td>{r.map}</td>
                          <td>{r.winPct}%</td>
                          <td>{r.games}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              {mPages > 1 ? (
                <div className="clan-pub-pager">
                  <button
                    type="button"
                    className="btn ghost"
                    disabled={mPage <= 0}
                    onClick={() => setMPage((p) => Math.max(0, p - 1))}
                  >
                    ←
                  </button>
                  <span>
                    {mPage + 1}/{mPages}
                  </span>
                  <button
                    type="button"
                    className="btn ghost"
                    disabled={mPage >= mPages - 1}
                    onClick={() =>
                      setMPage((p) => Math.min(mPages - 1, p + 1))
                    }
                  >
                    →
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </>
      ) : null}
    </section>
  );
}
