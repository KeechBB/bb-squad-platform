"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAutoRefresh } from "@/hooks/useAutoRefresh";
import {
  ATTENDANCE_CANON_START_YMD,
  TRAINING_PRESENT_MIN_MINUTES,
  isTrainingPresentMinutes,
} from "@/lib/squadSessions";

type Cell = { in: string; out: string | null; mins: number };

type Row = {
  regNo: number;
  userId: string;
  nick: string | null;
  steamId: string;
  cells: Record<string, Cell[]>;
  /** Дни «был» (≥60 мин вечером TR1) — тот же расчёт, что календарь профиля */
  presentDays?: string[];
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
  calendarUnique?: Array<{ day: string; players: number }>;
  avgPlayersPerDay: number;
  avgPlayersPerWeek?: number;
  avgPlayersPerMonth?: number;
  leaveTimeline?: Array<{ label: string; count: number; cumulative: number }>;
  joinTimeline?: Array<{ label: string; count: number; cumulative: number }>;
  joinNorm?: {
    onTime: number;
    lateOk: number;
    late: number;
    total: number;
  };
  windowLabel?: string;
  windowMode?: "day" | "evening";
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
const MONTHS_RU = [
  "январь",
  "февраль",
  "март",
  "апрель",
  "май",
  "июнь",
  "июль",
  "август",
  "сентябрь",
  "октябрь",
  "ноябрь",
  "декабрь",
];

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

/** Выход TR1: вне 21:00–01:00 белый; 23:30–01:00 зелёный; раньше — как было */
function leaveToneTr(hm: string): "ok" | "warn" | "bad" | "neutral" {
  const mins = parseHm(hm);
  if (mins == null) return "bad";
  const inEvening = mins >= 21 * 60 || mins < 1 * 60;
  if (!inEvening) return "neutral";
  const t = mins < 1 * 60 ? mins + 24 * 60 : mins;
  if (t >= 23 * 60 + 30 && t < 25 * 60) return "ok";
  if (t >= 23 * 60) return "warn";
  return "bad";
}

/** Выход PB1: <23:00 красный, 23:00–23:30 жёлтый, >23:30 зелёный */
function leaveTonePb(hm: string): "ok" | "warn" | "bad" {
  const mins = parseHm(hm);
  if (mins == null) return "bad";
  if (mins < 23 * 60) return "bad";
  if (mins <= 23 * 60 + 30) return "warn";
  return "ok";
}

/**
 * Минуты в окне 21:00–00:00 МСК по ячейке (только для UI тонов).
 * Явка «был» берётся из row.presentDays (общий расчёт с профилем).
 */
function eveningOverlapMinutes(c: Cell, dayYmd: string): number {
  const inM = parseHm(c.in);
  if (inM == null) return 0;
  const winStart = 21 * 60;
  const winEnd = 24 * 60;
  let outM = c.out ? parseHm(c.out) : null;
  if (outM != null && outM < inM) outM += 24 * 60;
  if (outM == null) {
    if (inM >= winEnd) return 0;
    if (dayYmd === todayYmdMsk()) {
      const nowM = nowMinsMsk();
      if (nowM < winStart) return 0;
      outM = Math.min(nowM, winEnd);
      if (outM < Math.max(inM, winStart)) return 0;
    } else {
      if (inM < winStart) return 0;
      outM = winEnd;
    }
  }
  const start = Math.max(inM, winStart);
  const end = Math.min(outM, winEnd);
  return Math.max(0, end - start);
}

function eveningMinutesForDay(cells: Cell[], dayYmd: string): number {
  return cells.reduce((s, c) => s + eveningOverlapMinutes(c, dayYmd), 0);
}

function wasPresentTr1(row: Row, dayYmd: string): boolean {
  if (row.presentDays?.length) return row.presentDays.includes(dayYmd);
  return isTrainingPresentMinutes(eveningMinutesForDay(row.cells[dayYmd] || [], dayYmd));
}

/** Сессия пересекается с окном тренировки 21:00–00:00 МСК */
function overlapsEveningWindow(c: Cell, dayYmd: string): boolean {
  return eveningOverlapMinutes(c, dayYmd) > 0;
}

function todayYmdMsk(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Moscow" });
}

function nowMinsMsk(): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Moscow",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const h = Number(parts.find((p) => p.type === "hour")?.value || 0);
  const m = Number(parts.find((p) => p.type === "minute")?.value || 0);
  return h * 60 + m;
}

/**
 * День закрыт для «не было»:
 * прошлое — да; сегодня — когда уже нельзя набрать 60 мин до 00:00.
 */
function absenceDecided(dayYmd: string, eveningMins = 0): boolean {
  const today = todayYmdMsk();
  if (dayYmd < today) return true;
  if (dayYmd > today) return false;
  if (isTrainingPresentMinutes(eveningMins)) return true;
  const now = nowMinsMsk();
  if (now < 21 * 60) return false;
  const remaining = 24 * 60 - now;
  return eveningMins + remaining < TRAINING_PRESENT_MIN_MINUTES;
}

/**
 * Пустая ячейка TR1 / вечер < 1ч:
 * будущее / сегодня ещё можно успеть → —
 * сегодня 21:00–21:30 → опаздывает
 * иначе не был / не было
 */
function emptyTrLabel(dayYmd: string): { text: string; className: string } {
  const today = todayYmdMsk();
  if (dayYmd > today) {
    return { text: "—", className: "attend-cell empty" };
  }
  if (dayYmd < today) {
    return { text: "не было", className: "attend-cell attend-absent" };
  }
  const mins = nowMinsMsk();
  if (mins < 21 * 60) {
    return { text: "—", className: "attend-cell empty" };
  }
  if (mins < 21 * 60 + 30) {
    return { text: "опаздывает", className: "attend-cell attend-late" };
  }
  const remaining = 24 * 60 - mins;
  if (remaining >= TRAINING_PRESENT_MIN_MINUTES) {
    return { text: "—", className: "attend-cell empty" };
  }
  return { text: "не был", className: "attend-cell attend-absent" };
}

function defaultRange(): { from: string; to: string } {
  const now = new Date();
  const to = now.toLocaleDateString("en-CA", { timeZone: "Europe/Moscow" });
  // from: max(канон 15.09.2026, to-29d)
  const [y, m, d] = to.split("-").map(Number);
  const end = new Date(Date.UTC(y, m - 1, d));
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 29);
  const floor = new Date(Date.UTC(2026, 8, 15));
  const fromD = start < floor ? floor : start;
  const from = `${fromD.getUTCFullYear()}-${String(fromD.getUTCMonth() + 1).padStart(2, "0")}-${String(fromD.getUTCDate()).padStart(2, "0")}`;
  return { from, to };
}

function BarChart({
  items,
}: {
  items: Array<{ label: string; value: number; color?: string; sub?: string }>;
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
          {i.sub ? <em className="attend-bar-sub">{i.sub}</em> : null}
        </div>
      ))}
    </div>
  );
}

function TimelineTable({
  rows,
  countLabel,
}: {
  rows: Array<{ label: string; count: number; cumulative: number }>;
  countLabel: string;
}) {
  if (!rows.length) {
    return <p className="muted">Нет данных за период</p>;
  }
  return (
    <div className="admin-table-wrap attend-timeline-wrap">
      <table className="admin-table attend-timeline-table">
        <thead>
          <tr>
            <th>Время</th>
            <th>{countLabel}</th>
            <th>Накопительно</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <td>{r.label}</td>
              <td>{r.count}</td>
              <td>{r.cumulative}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StatsMonthCalendar({
  days,
  counts,
}: {
  days: string[];
  counts: Map<string, number>;
}) {
  const months = useMemo(() => {
    const set = new Set<string>();
    for (const d of days) set.add(d.slice(0, 7));
    return [...set].sort();
  }, [days]);

  return (
    <div className="attend-stats-cal-list">
      {months.map((ym) => {
        const [y, m] = ym.split("-").map(Number);
        const first = new Date(Date.UTC(y, m - 1, 1));
        const startDow = first.getUTCDay();
        const mondayOffset = startDow === 0 ? 6 : startDow - 1;
        const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
        const cells: Array<{ day: number | null; ymd: string | null }> = [];
        for (let i = 0; i < mondayOffset; i++) cells.push({ day: null, ymd: null });
        for (let d = 1; d <= daysInMonth; d++) {
          const ymd = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
          cells.push({ day: d, ymd });
        }
        while (cells.length % 7 !== 0) cells.push({ day: null, ymd: null });
        const monthName = MONTHS_RU[m - 1];
        return (
          <div key={ym} className="attend-stats-cal">
            <h4>
              {monthName} {y}
            </h4>
            <div className="attend-stats-cal-weekdays">
              {WEEKDAYS.map((w) => (
                <span key={w}>{w}</span>
              ))}
            </div>
            <div className="attend-stats-cal-grid">
              {cells.map((c, i) => {
                if (!c.ymd || c.day == null) {
                  return <div key={`e-${ym}-${i}`} className="attend-stats-cal-cell empty" />;
                }
                const inRange = days.includes(c.ymd);
                const n = counts.get(c.ymd) || 0;
                return (
                  <div
                    key={c.ymd}
                    className={`attend-stats-cal-cell${inRange ? " in-range" : ""}${
                      n > 0 ? " has-players" : ""
                    }`}
                    title={
                      inRange
                        ? `${c.ymd}: ${n} уникальных (21:00–01:00)`
                        : "Вне выбранного периода"
                    }
                  >
                    <span className="attend-stats-cal-day">{c.day}</span>
                    {inRange ? (
                      <span className="attend-stats-cal-num">{n || "·"}</span>
                    ) : (
                      <span className="attend-stats-cal-num muted">·</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
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
  const [onlyAbsent, setOnlyAbsent] = useState(false);
  const [nickQuery, setNickQuery] = useState("");
  const [showIn, setShowIn] = useState(true);
  const [showOut, setShowOut] = useState(true);
  const [server, setServer] = useState<ServerFilter>("TR1");

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) {
      setLoading(true);
      setErr(null);
    }
    try {
      const q = new URLSearchParams({ from, to, server });
      const res = await fetch(`/api/admin/attendance?${q}`, {
        cache: "no-store",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Ошибка загрузки");
      setData(json as Payload);
      if (opts?.silent) setErr(null);
    } catch (e) {
      if (!opts?.silent) {
        setErr(e instanceof Error ? e.message : "Ошибка");
      }
    } finally {
      if (!opts?.silent) setLoading(false);
    }
  }, [from, to, server]);

  useEffect(() => {
    void load();
  }, [load]);

  useAutoRefresh(() => load({ silent: true }), {
    intervalMs: 15000,
    kinds: ["attendance"],
  });

  const rows = useMemo(() => {
    if (!data) return [];
    const q = nickQuery.trim().toLowerCase();
    let list = data.rows;
    if (q) {
      list = list.filter((r) => {
        const nick = (r.nick || "").toLowerCase();
        const steam = (r.steamId || "").toLowerCase();
        return nick.includes(q) || steam.includes(q);
      });
    }
    if (!onlyAbsent) return list;
    const isTr = (data.server || server) === "TR1";
    return list.filter((r) => {
      const decidedDays = data.days.filter((d) => {
        if (!isTr) return d <= todayYmdMsk();
        const mins = wasPresentTr1(r, d)
          ? TRAINING_PRESENT_MIN_MINUTES
          : eveningMinutesForDay(r.cells[d] || [], d);
        return absenceDecided(d, mins);
      });
      if (!decidedDays.length) return false;
      const wasPresent = decidedDays.some((d) => {
        const cells = r.cells[d] || [];
        if (!cells.length && !(r.presentDays || []).includes(d)) return false;
        if (!isTr) return cells.length > 0;
        return wasPresentTr1(r, d);
      });
      return !wasPresent;
    });
  }, [data, onlyAbsent, server, nickQuery]);

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
            min={ATTENDANCE_CANON_START_YMD}
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
            min={ATTENDANCE_CANON_START_YMD}
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
        <label className="field attend-nick-search">
          <span>Ник</span>
          <input
            type="search"
            className="attend-date-input"
            placeholder="поиск по нику / Steam"
            value={nickQuery}
            onChange={(e) => setNickQuery(e.target.value)}
            autoComplete="off"
          />
        </label>
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
            checked={onlyAbsent}
            onChange={(e) => setOnlyAbsent(e.target.checked)}
          />
          <span>Только тех, кого не было</span>
        </label>
      </div>
      <p className="muted" style={{ marginTop: 0 }}>
        Окно не больше 30 дней. Старт учёта: 15.09.2026 (логов раньше нет).
        {data ? ` · Показано дней: ${data.days.length}` : ""}
        {data && nickQuery.trim()
          ? ` · Найдено: ${rows.length} из ${data.rows.length}`
          : ""}
        {` · Сервер: ${server === "TR1" ? "TR1 (тренировка)" : "PB1 (паблик)"}`}
        {" · Автообновление ~15 сек"}
        {tab === "table"
          ? [
              server === "TR1"
                ? ` · Заход виден сразу (… = ещё на сервере). «Был» = ≥${TRAINING_PRESENT_MIN_MINUTES} мин в 21:00–00:00`
                : "",
              showIn
                ? " · Цвет захода: ≤21:00 зел., 21:00–21:30 жёлт., после 21:30 красн."
                : "",
              showOut
                ? server === "TR1"
                  ? " · Цвет выхода TR1: 23:30–01:00 зел.; до 23:30 в окне — жёлт./красн.; вне 21:00–01:00 белый."
                  : " · Цвет выхода: до 23:00 красн., 23:00–23:30 жёлт., после 23:30 зел."
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
                    const isTr = (data.server || server) === "TR1";
                    // Любой заход за день сразу виден (не только окно 21:00–00:00)
                    const dayCells = cells;
                    if (!dayCells.length || (!showIn && !showOut)) {
                      if (!(showIn || showOut)) {
                        return (
                          <td key={d}>
                            <span className="attend-cell empty">—</span>
                          </td>
                        );
                      }
                      if (isTr) {
                        if (wasPresentTr1(r, d)) {
                          return (
                            <td key={d}>
                              <span className="attend-cell attend-present">был</span>
                            </td>
                          );
                        }
                        const empty = emptyTrLabel(d);
                        return (
                          <td key={d}>
                            <span className={empty.className}>{empty.text}</span>
                          </td>
                        );
                      }
                      return (
                        <td key={d}>
                          <span className="attend-cell empty">—</span>
                        </td>
                      );
                    }
                    return (
                      <td key={d}>
                        <div className="attend-cell">
                          {dayCells.map((c, i) => (
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
                                  <span
                                    className={`attend-time ${
                                      isTr
                                        ? leaveToneTr(c.out)
                                        : leaveTonePb(c.out)
                                    }`}
                                  >
                                    {c.out}
                                  </span>
                                ) : (
                                  <span
                                    className="attend-time attend-online"
                                    title="Сейчас на сервере"
                                  >
                                    …
                                  </span>
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
        <div className="attend-stats-grid attend-stats-grid-v2">
          <div className="training-chart-block">
            <h3>Средние (окно 21:00–00:00)</h3>
            <div className="meta-row">
              <span>В среднем за день</span>
              <span>{data.stats.avgPlayersPerDay}</span>
            </div>
            <div className="meta-row">
              <span>В среднем за неделю</span>
              <span>{data.stats.avgPlayersPerWeek ?? "—"}</span>
            </div>
            <div className="meta-row">
              <span>В среднем за месяц</span>
              <span>{data.stats.avgPlayersPerMonth ?? "—"}</span>
            </div>
            <p className="muted" style={{ margin: "8px 0 0", fontSize: "0.78rem" }}>
              Уникальные игроки с пересечением 21:00–00:00 МСК. Неделя/месяц —
              сумма вечерних уникальных по дням, усреднённая по неделям/месяцам
              в выбранном периоде.
            </p>
          </div>

          <div className="training-chart-block">
            <h3>Норма захода</h3>
            {data.stats.joinNorm ? (
              <>
                <div className="attend-norm-row">
                  <div className="attend-norm-pill ok">
                    <strong>{data.stats.joinNorm.onTime}</strong>
                    <span>≤21:00 норм</span>
                  </div>
                  <div className="attend-norm-pill warn">
                    <strong>{data.stats.joinNorm.lateOk}</strong>
                    <span>21:00–21:30</span>
                  </div>
                  <div className="attend-norm-pill bad">
                    <strong>{data.stats.joinNorm.late}</strong>
                    <span>после 21:30</span>
                  </div>
                </div>
                <p className="muted" style={{ margin: "8px 0 0", fontSize: "0.78rem" }}>
                  По первому заходу в вечер (21:00–01:00), человек×день:{" "}
                  {data.stats.joinNorm.total}
                </p>
              </>
            ) : (
              <p className="muted">Для PB1 норма захода не считается</p>
            )}
          </div>

          <div className="training-chart-block" style={{ gridColumn: "1 / -1" }}>
            <h3>Выходы — сколько и во сколько ушли</h3>
            <BarChart
              items={(data.stats.leaveTimeline || []).map((x) => ({
                label: x.label,
                value: x.count,
                sub: `Σ${x.cumulative}`,
                color:
                  x.label.startsWith("23") || x.label.startsWith("00")
                    ? "linear-gradient(180deg,#86efac,#16a34a)"
                    : x.label.startsWith("22")
                      ? "linear-gradient(180deg,#fde047,#ca8a04)"
                      : undefined,
              }))}
            />
            <TimelineTable
              rows={data.stats.leaveTimeline || []}
              countLabel="Ушли"
            />
          </div>

          <div className="training-chart-block" style={{ gridColumn: "1 / -1" }}>
            <h3>Заходы — сколько и когда зашли (+ накопительно)</h3>
            <BarChart
              items={(data.stats.joinTimeline || []).map((x) => ({
                label: x.label,
                value: x.count,
                sub: `Σ${x.cumulative}`,
                color:
                  x.label === "21:00" ||
                  x.label.startsWith("≤") ||
                  x.label.startsWith("20")
                    ? "linear-gradient(180deg,#86efac,#16a34a)"
                    : x.label === "21:30"
                      ? "linear-gradient(180deg,#fde047,#ca8a04)"
                      : "linear-gradient(180deg,#fca5a5,#dc2626)",
              }))}
            />
            <TimelineTable
              rows={data.stats.joinTimeline || []}
              countLabel="Зашли"
            />
          </div>

          <div className="training-chart-block" style={{ gridColumn: "1 / -1" }}>
            <h3>Календарь уникальных (21:00–01:00)</h3>
            <p className="muted" style={{ marginTop: 0 }}>
              Цифра на дате — сколько уникальных было в окне 21:00–01:00 МСК.
              Вне этого окна в цифру не входят.
            </p>
            <StatsMonthCalendar
              days={data.days}
              counts={
                new Map(
                  (data.stats.calendarUnique || data.stats.dayPlayerCounts).map(
                    (x) => [x.day, x.players]
                  )
                )
              }
            />
          </div>
        </div>
      ) : null}
    </section>
  );
}
