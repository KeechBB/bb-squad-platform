"use client";

import { useMemo, useState } from "react";
import {
  ATTENDANCE_CANON_START_YMD,
  ATTENDANCE_LABEL,
  attendanceTag,
  formatDurationMinutes,
  formatMskDateTime,
  mskParts,
  type AttendanceTag,
} from "@/lib/squadSessions";

export type SessionRow = {
  id: string;
  joinedAt: Date | string;
  leftAt: Date | string | null;
  nickAtJoin: string | null;
  serverKey: string;
};

type NormSession = {
  id: string;
  joinedAt: Date;
  leftAt: Date | null;
  nickAtJoin: string | null;
  serverKey: string;
};

type Props = {
  sessions: SessionRow[];
  minutes30d: number;
  sessions30d: number;
  openNow: boolean;
};

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

function asDate(d: Date | string): Date {
  return d instanceof Date ? d : new Date(d);
}

function normalizeSessions(rows: SessionRow[]): NormSession[] {
  return rows.map((s) => ({
    id: s.id,
    joinedAt: asDate(s.joinedAt),
    leftAt: s.leftAt ? asDate(s.leftAt) : null,
    nickAtJoin: s.nickAtJoin,
    serverKey: s.serverKey || "TPUB1",
  }));
}

function tagClass(tag: AttendanceTag): string {
  if (tag === "on_time") return "att-tag on-time";
  if (tag === "late_ok") return "att-tag late-ok";
  if (tag === "late") return "att-tag late";
  return "att-tag other";
}

function serverLabel(key: string): "TR1" | "PB1" | string {
  const k = key.toUpperCase();
  if (k === "TR1") return "TR1";
  if (k === "TPUB1" || k === "PB1" || k === "PUB") return "PB1";
  return key;
}

function serverPillClass(key: string): string {
  const label = serverLabel(key);
  if (label === "TR1") return "server-pill tr1";
  if (label === "PB1") return "server-pill pb1";
  return "server-pill";
}

function ymdFromParts(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function todayYmdMsk(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Moscow" });
}

function nowMinsMsk(): number {
  const p = mskParts(new Date());
  return p.h * 60 + p.min;
}

/** Сессия пересекает окно тренировки 21:00–00:00 МСК */
function isTrainingEvening(s: NormSession): boolean {
  if (serverLabel(s.serverKey) !== "TR1") return false;
  const jp = mskParts(s.joinedAt);
  const inM = jp.h * 60 + jp.min;
  let outM: number | null = null;
  if (s.leftAt) {
    const lp = mskParts(s.leftAt);
    outM = lp.h * 60 + lp.min;
    const jDay = ymdFromParts(jp.y, jp.m, jp.day);
    const lDay = ymdFromParts(lp.y, lp.m, lp.day);
    if (lDay > jDay) outM += 24 * 60;
    else if (outM < inM) outM += 24 * 60;
  }
  if (outM == null) {
    return inM >= 21 * 60 && inM < 24 * 60;
  }
  return inM < 24 * 60 && outM > 21 * 60;
}

type DayMark = "present" | "absent" | "pending" | "outside";

function dayMark(
  ymd: string,
  presentDays: Set<string>
): DayMark {
  if (ymd < ATTENDANCE_CANON_START_YMD) return "outside";
  const today = todayYmdMsk();
  if (ymd > today) return "pending";
  if (ymd === today && nowMinsMsk() < 21 * 60) return "pending";
  if (presentDays.has(ymd)) return "present";
  return "absent";
}

function buildMonthGrid(year: number, month: number) {
  // month 1-12
  const first = new Date(Date.UTC(year, month - 1, 1));
  const startDow = first.getUTCDay(); // 0 Sun
  const mondayOffset = startDow === 0 ? 6 : startDow - 1;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cells: Array<{ day: number | null; ymd: string | null }> = [];
  for (let i = 0; i < mondayOffset; i++) cells.push({ day: null, ymd: null });
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ day: d, ymd: ymdFromParts(year, month, d) });
  }
  while (cells.length % 7 !== 0) cells.push({ day: null, ymd: null });
  return cells;
}

export function TrainingSessionsCard({
  sessions,
  minutes30d,
  sessions30d,
  openNow,
}: Props) {
  const normalized = useMemo(() => normalizeSessions(sessions), [sessions]);
  const today = todayYmdMsk();
  const [ty, tm] = today.split("-").map(Number);
  const [canonY, canonM] = ATTENDANCE_CANON_START_YMD.split("-").map(Number);
  const [viewY, setViewY] = useState(ty);
  const [viewM, setViewM] = useState(tm);

  const presentTrainingDays = useMemo(() => {
    const set = new Set<string>();
    for (const s of normalized) {
      if (!isTrainingEvening(s)) continue;
      const p = mskParts(s.joinedAt);
      let day = ymdFromParts(p.y, p.m, p.day);
      if (p.h < 12) {
        const prev = new Date(Date.UTC(p.y, p.m - 1, p.day - 1));
        day = ymdFromParts(
          prev.getUTCFullYear(),
          prev.getUTCMonth() + 1,
          prev.getUTCDate()
        );
      }
      set.add(day);
    }
    return set;
  }, [normalized]);

  const avgMin = useMemo(() => {
    if (!sessions30d) return 0;
    return Math.round(minutes30d / sessions30d);
  }, [minutes30d, sessions30d]);

  const monthSessions = normalized.slice(0, 60);
  const cells = buildMonthGrid(viewY, viewM);

  const canPrev =
    viewY > canonY || (viewY === canonY && viewM > canonM);
  const canNext = viewY < ty || (viewY === ty && viewM < tm);

  function shiftMonth(delta: number) {
    let m = viewM + delta;
    let y = viewY;
    if (m < 1) {
      m = 12;
      y -= 1;
    } else if (m > 12) {
      m = 1;
      y += 1;
    }
    setViewY(y);
    setViewM(m);
  }

  const presentInView = cells.filter(
    (c) => c.ymd && dayMark(c.ymd, presentTrainingDays) === "present"
  ).length;
  const absentInView = cells.filter(
    (c) => c.ymd && dayMark(c.ymd, presentTrainingDays) === "absent"
  ).length;

  return (
    <section className="card training-sessions-card">
      <h2>Посещаемость тренировок</h2>
      <p className="muted" style={{ marginTop: 6, marginBottom: 0 }}>
        TR1 — тренировка (вечер), PB1 — паблик. Учёт с 15.09.2026.
      </p>

      <div className="training-stat-row">
        <div>
          <strong>{sessions30d}</strong>
          <span className="muted">сессий / 30 дн</span>
        </div>
        <div>
          <strong>{minutes30d}</strong>
          <span className="muted">мин / 30 дн</span>
        </div>
        <div>
          <strong>{avgMin || "—"}</strong>
          <span className="muted">сред. мин / сессия</span>
        </div>
        <div>
          <strong>{openNow ? "онлайн" : "—"}</strong>
          <span className="muted">сейчас</span>
        </div>
      </div>

      <div className="training-charts">
        <div className="training-chart-block training-cal-block">
          <div className="training-cal-head">
            <h3>Календарь тренировок (TR1)</h3>
            <div className="training-cal-nav">
              <button
                type="button"
                className="btn ghost"
                disabled={!canPrev}
                onClick={() => shiftMonth(-1)}
                aria-label="Предыдущий месяц"
              >
                ←
              </button>
              <span className="training-cal-title">
                {MONTHS_RU[viewM - 1]} {viewY}
              </span>
              <button
                type="button"
                className="btn ghost"
                disabled={!canNext}
                onClick={() => shiftMonth(1)}
                aria-label="Следующий месяц"
              >
                →
              </button>
            </div>
          </div>
          <div className="training-cal-weekdays">
            {WEEKDAYS.map((d) => (
              <span key={d}>{d}</span>
            ))}
          </div>
          <div className="training-cal-grid">
            {cells.map((c, i) => {
              if (!c.ymd || c.day == null) {
                return <div key={`e-${i}`} className="training-cal-cell empty" />;
              }
              const mark = dayMark(c.ymd, presentTrainingDays);
              return (
                <div
                  key={c.ymd}
                  className={`training-cal-cell mark-${mark}${
                    c.ymd === today ? " is-today" : ""
                  }`}
                  title={
                    mark === "present"
                      ? "Был на тренировке"
                      : mark === "absent"
                        ? "Не был"
                        : mark === "pending"
                          ? "Ещё рано"
                          : "Вне учёта"
                  }
                >
                  <span className="training-cal-day">{c.day}</span>
                  {mark === "present" ? (
                    <span className="training-cal-dot">был</span>
                  ) : mark === "absent" ? (
                    <span className="training-cal-dot">нет</span>
                  ) : (
                    <span className="training-cal-dot muted">·</span>
                  )}
                </div>
              );
            })}
          </div>
          <p className="muted training-cal-legend">
            Зелёный — был на TR1 вечером · красный — не было · серый — ещё
            не считаем. В этом месяце:{" "}
            <strong>{presentInView}</strong> был /{" "}
            <strong>{absentInView}</strong> нет
          </p>
        </div>
        <div className="training-chart-block">
          <h3>Среднее время на сервере</h3>
          <p className="training-avg-big">
            {avgMin > 0 ? (
              <>
                <strong>{avgMin}</strong>
                <span>мин за заход</span>
              </>
            ) : (
              <span className="muted">Пока мало данных</span>
            )}
          </p>
          <p className="muted" style={{ margin: "8px 0 0", fontSize: "0.85rem" }}>
            Сумма за 30 дней: {minutes30d} мин · {sessions30d} заходов (TR1+PB1)
          </p>
        </div>
      </div>

      {monthSessions.length === 0 ? (
        <p className="muted" style={{ marginTop: 14 }}>
          Пока нет зафиксированных заходов. Коллектор логов должен работать.
        </p>
      ) : (
        <div className="admin-table-wrap" style={{ marginTop: 14 }}>
          <table className="admin-table training-sessions-table">
            <thead>
              <tr>
                <th>Сервер</th>
                <th>Зашёл (МСК)</th>
                <th>Вышел</th>
                <th>Мин</th>
                <th>Метка</th>
                <th>Ник на сервере</th>
              </tr>
            </thead>
            <tbody>
              {monthSessions.map((s) => {
                const tag = attendanceTag(s.joinedAt);
                const mins = formatDurationMinutes(s.joinedAt, s.leftAt);
                const srv = serverLabel(s.serverKey);
                return (
                  <tr key={s.id}>
                    <td>
                      <span className={serverPillClass(s.serverKey)}>{srv}</span>
                    </td>
                    <td>{formatMskDateTime(s.joinedAt)}</td>
                    <td>
                      {s.leftAt ? formatMskDateTime(s.leftAt) : "на сервере"}
                    </td>
                    <td>{mins}</td>
                    <td>
                      <span className={tagClass(tag)}>
                        {ATTENDANCE_LABEL[tag]}
                      </span>
                    </td>
                    <td>{s.nickAtJoin || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
