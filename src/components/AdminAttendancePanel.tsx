"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

type Cell = { in: string; out: string | null; mins: number };

type Row = {
  regNo: number;
  userId: string;
  nick: string | null;
  steamId: string;
  cells: Record<string, Cell[]>;
};

type Stats = {
  totalSessions: number;
  totalMinutes: number;
  avgSessionMin: number;
  uniquePlayers: number;
  leaveBucket: Record<string, number>;
  joinBucket: Record<string, number>;
  weekday: number[];
  dayPlayerCounts: Array<{ day: string; players: number }>;
  avgPlayersPerDay: number;
};

type Payload = {
  from: string;
  to: string;
  server?: string;
  days: string[];
  rows: Row[];
  stats: Stats;
};

/** UI labels; PB1 maps to TPUB1 in DB */
type ServerFilter = "TR1" | "PB1";

const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

function ymdLabel(ymd: string): string {
  const [, m, d] = ymd.split("-");
  return `${d}.${m}`;
}

function parseHm(hm: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(hm);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Заход: ≤21:00 зелёный, 21:00–21:30 жёлтый, >21:30 красный */
function joinTone(hm: string): "ok" | "warn" | "bad" {
  const mins = parseHm(hm);
  if (mins == null) return "bad";
  if (mins <= 21 * 60) return "ok";
  if (mins <= 21 * 60 + 30) return "warn";
  return "bad";
}

/** Выход: <23:00 красный, 23:00–23:30 жёлтый, >23:30 зелёный */
function leaveTone(hm: string): "ok" | "warn" | "bad" {
  const mins = parseHm(hm);
  if (mins == null) return "bad";
  if (mins < 23 * 60) return "bad";
  if (mins <= 23 * 60 + 30) return "warn";
  return "ok";
}

function defaultRange(): { from: string; to: string } {
  const now = new Date();
  const to = now.toLocaleDateString("en-CA", { timeZone: "Europe/Moscow" });
  // from: max(2026-09-01, to-29d)
  const [y, m, d] = to.split("-").map(Number);
  const end = new Date(Date.UTC(y, m - 1, d));
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 29);
  const floor = new Date(Date.UTC(2026, 8, 1));
  const fromD = start < floor ? floor : start;
  const from = `${fromD.getUTCFullYear()}-${String(fromD.getUTCMonth() + 1).padStart(2, "0")}-${String(fromD.getUTCDate()).padStart(2, "0")}`;
  return { from, to };
}

function BarChart({
  items,
}: {
  items: Array<{ label: string; value: number; color?: string }>;
}) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <div className="training-bars" style={{ minHeight: 140 }}>
      {items.map((i) => (
        <div key={i.label} className="training-bar-col">
          <div className="training-bar-track" style={{ height: 110 }}>
            <div
              className="training-bar-fill"
              style={{
                height: `${Math.round((100 * i.value) / max)}%`,
                background: i.color || undefined,
              }}
            />
          </div>
          <span>{i.label}</span>
          <strong>{i.value}</strong>
        </div>
      ))}
    </div>
  );
}

export function AdminAttendancePanel() {
  const init = useMemo(() => defaultRange(), []);
  const [from, setFrom] = useState(init.from);
  const [to, setTo] = useState(init.to);
  const [tab, setTab] = useState<"table" | "stats">("table");
  const [data, setData] = useState<Payload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [onlyPresent, setOnlyPresent] = useState(true);
  const [showIn, setShowIn] = useState(true);
  const [showOut, setShowOut] = useState(true);
  const [server, setServer] = useState<ServerFilter>("TR1");

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const q = new URLSearchParams({ from, to, server });
      const res = await fetch(`/api/admin/attendance?${q}`, {
        cache: "no-store",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Ошибка загрузки");
      setData(json as Payload);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setLoading(false);
    }
  }, [from, to, server]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo(() => {
    if (!data) return [];
    if (!onlyPresent) return data.rows;
    return data.rows.filter((r) =>
      data.days.some((d) => (r.cells[d] || []).length > 0)
    );
  }, [data, onlyPresent]);

  return (
    <section className="card" style={{ marginTop: 8 }}>
      <div className="admin-tabs" role="tablist">
        <button
          type="button"
          className={`admin-tab ${tab === "table" ? "active" : ""}`}
          onClick={() => setTab("table")}
        >
          Таблица
        </button>
        <button
          type="button"
          className={`admin-tab ${tab === "stats" ? "active" : ""}`}
          onClick={() => setTab("stats")}
        >
          Статистика
        </button>
      </div>

      <div className="attend-filter-row">
        <label className="field">
          <span>С</span>
          <input
            type="date"
            className="attend-date-input"
            value={from}
            min="2026-09-01"
            onChange={(e) => setFrom(e.target.value)}
            onClick={(e) => {
              const el = e.currentTarget;
              try {
                el.showPicker?.();
              } catch {
                /* older browsers */
              }
            }}
            onFocus={(e) => {
              const el = e.currentTarget;
              try {
                el.showPicker?.();
              } catch {
                /* ignore */
              }
            }}
          />
        </label>
        <label className="field">
          <span>По</span>
          <input
            type="date"
            className="attend-date-input"
            value={to}
            min="2026-09-01"
            onChange={(e) => setTo(e.target.value)}
            onClick={(e) => {
              const el = e.currentTarget;
              try {
                el.showPicker?.();
              } catch {
                /* older browsers */
              }
            }}
            onFocus={(e) => {
              const el = e.currentTarget;
              try {
                el.showPicker?.();
              } catch {
                /* ignore */
              }
            }}
          />
        </label>
        <button type="button" className="btn" onClick={() => void load()} disabled={loading}>
          {loading ? "…" : "Применить"}
        </button>
        <div className="attend-mode-toggle" role="group" aria-label="Зашёл и вышел">
          <button
            type="button"
            className={showIn ? "active" : ""}
            aria-pressed={showIn}
            onClick={() => setShowIn((v) => !v)}
          >
            Зашёл
          </button>
          <button
            type="button"
            className={showOut ? "active" : ""}
            aria-pressed={showOut}
            onClick={() => setShowOut((v) => !v)}
          >
            Вышел
          </button>
        </div>
        <div className="attend-mode-toggle" role="group" aria-label="Сервер">
          <button
            type="button"
            className={server === "TR1" ? "active" : ""}
            onClick={() => setServer("TR1")}
            title="Тренировочный сервер"
          >
            TR1
          </button>
          <button
            type="button"
            className={server === "PB1" ? "active" : ""}
            onClick={() => setServer("PB1")}
            title="Паблик (TPUB1)"
          >
            PB1
          </button>
        </div>
        <label className="field" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <input
            type="checkbox"
            checked={onlyPresent}
            onChange={(e) => setOnlyPresent(e.target.checked)}
          />
          <span>Только кто заходил в периоде</span>
        </label>
      </div>
      <p className="muted" style={{ marginTop: 0 }}>
        Окно не больше 30 дней. Старт канона: 01.09.2026.
        {data ? ` · Показано дней: ${data.days.length}` : ""}
        {` · Сервер: ${server === "TR1" ? "TR1 (тренировка)" : "PB1 (паблик)"}`}
        {tab === "table"
          ? [
              showIn
                ? " · Цвет захода: ≤21:00 зел., 21:00–21:30 жёлт., после 21:30 красн."
                : "",
              showOut
                ? " · Цвет выхода: до 23:00 красн., 23:00–23:30 жёлт., после 23:30 зел."
                : "",
            ].join("")
          : ""}
      </p>
      {err ? <p style={{ color: "#fca5a5" }}>{err}</p> : null}

      {tab === "table" && data ? (
        <div className="attend-matrix-wrap">
          <table className="attend-matrix">
            <thead>
              <tr>
                <th>№</th>
                <th>Ник</th>
                <th>Steam ID</th>
                {data.days.map((d) => (
                  <th key={d}>{ymdLabel(d)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.userId}>
                  <td>{r.regNo}</td>
                  <td>
                    {r.nick ? (
                      <Link
                        className="player-nick-link"
                        href={`/players/${encodeURIComponent(r.nick)}`}
                      >
                        {r.nick}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="mono">{r.steamId}</td>
                  {data.days.map((d) => {
                    const cells = r.cells[d] || [];
                    if (!cells.length || (!showIn && !showOut)) {
                      return (
                        <td key={d}>
                          <span className="attend-cell empty">—</span>
                        </td>
                      );
                    }
                    return (
                      <td key={d}>
                        <div className="attend-cell">
                          {cells.map((c, i) => (
                            <span key={i} className="attend-time-pair">
                              {showIn ? (
                                <span className={`attend-time ${joinTone(c.in)}`}>
                                  {c.in}
                                </span>
                              ) : null}
                              {showIn && showOut ? (
                                <span className="attend-time-sep">–</span>
                              ) : null}
                              {showOut ? (
                                c.out ? (
                                  <span className={`attend-time ${leaveTone(c.out)}`}>
                                    {c.out}
                                  </span>
                                ) : (
                                  <span className="attend-cell empty">…</span>
                                )
                              ) : null}
                            </span>
                          ))}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {tab === "stats" && data ? (
        <div className="attend-stats-grid">
          <div className="training-chart-block">
            <h3>Сводка</h3>
            <div className="meta-row">
              <span>Сессий</span>
              <span>{data.stats.totalSessions}</span>
            </div>
            <div className="meta-row">
              <span>Уникальных игроков</span>
              <span>{data.stats.uniquePlayers}</span>
            </div>
            <div className="meta-row">
              <span>Сумма минут</span>
              <span>{data.stats.totalMinutes}</span>
            </div>
            <div className="meta-row">
              <span>Сред. мин / сессия</span>
              <span>{data.stats.avgSessionMin}</span>
            </div>
            <div className="meta-row">
              <span>Сред. игроков / вечер</span>
              <span>{data.stats.avgPlayersPerDay}</span>
            </div>
            <p className="muted" style={{ margin: "6px 0 0", fontSize: "0.78rem" }}>
              Окно 21:30–00:00 МСК
            </p>
          </div>

          <div className="training-chart-block">
            <h3>Выход по часам (МСК)</h3>
            <BarChart
              items={[
                { label: "21", value: data.stats.leaveBucket["21"] || 0 },
                { label: "22", value: data.stats.leaveBucket["22"] || 0, color: "linear-gradient(180deg,#86efac,#16a34a)" },
                { label: "23", value: data.stats.leaveBucket["23"] || 0, color: "linear-gradient(180deg,#fde047,#ca8a04)" },
                { label: "00", value: data.stats.leaveBucket["00"] || 0, color: "linear-gradient(180deg,#fca5a5,#dc2626)" },
                { label: "01", value: data.stats.leaveBucket["01"] || 0 },
                { label: "др", value: data.stats.leaveBucket.other || 0 },
              ]}
            />
          </div>

          <div className="training-chart-block">
            <h3>Заход (метка)</h3>
            <BarChart
              items={[
                {
                  label: "≤21:00",
                  value: data.stats.joinBucket.before21 || 0,
                  color: "linear-gradient(180deg,#86efac,#16a34a)",
                },
                {
                  label: "21–21:30",
                  value: data.stats.joinBucket["2130"] || 0,
                  color: "linear-gradient(180deg,#fde047,#ca8a04)",
                },
                {
                  label: ">21:30",
                  value: data.stats.joinBucket.after2130 || 0,
                  color: "linear-gradient(180deg,#fca5a5,#dc2626)",
                },
              ]}
            />
          </div>

          <div className="training-chart-block">
            <h3>По дням недели</h3>
            <BarChart
              items={WEEKDAYS.map((label, i) => ({
                label,
                value: data.stats.weekday[i] || 0,
              }))}
            />
          </div>

          <div className="training-chart-block" style={{ gridColumn: "1 / -1" }}>
            <h3>Игроков по вечерам (21:30–00:00)</h3>
            <BarChart
              items={data.stats.dayPlayerCounts.map((x) => ({
                label: ymdLabel(x.day),
                value: x.players,
              }))}
            />
          </div>
        </div>
      ) : null}
    </section>
  );
}
