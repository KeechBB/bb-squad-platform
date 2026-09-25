"use client";

import { useMemo, useState } from "react";
import {
  ATTENDANCE_CANON_START_YMD,
  TRAINING_PRESENT_MIN_MINUTES,
  trainingDayMarksFromSessions,
} from "@/lib/squadSessions";
import type { TrainMatchHistoryRow } from "@/lib/homeTrainPwr";

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
  /** Готовые дни «был» с сервера (чтобы не тащить все сессии на клиент) */
  presentDays?: string[];
  /** «Был» с заходом после 21:00 — жёлтый */
  lateDays?: string[];
  /** Заход / итоговый выход по дням (с 19:00, gap ≤5 мин = не выход) */
  visitBounds?: Record<string, { joinHm: string; leaveHm: string | null }>;
  /** История тренировочных матчей с ΔPWR */
  matchHistory?: TrainMatchHistoryRow[];
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

function ymdFromParts(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function todayYmdMsk(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Moscow" });
}

type DayMark = "present" | "late" | "absent" | "pending" | "outside";

function parseJoinHm(hm: string | undefined): number | null {
  if (!hm) return null;
  const m = /^(\d{2}):(\d{2})$/.exec(hm);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** ≥21:00 МСК на календаре = опоздание (жёлтый). */
function isLateJoinHm(hm: string | undefined): boolean {
  const mins = parseJoinHm(hm);
  if (mins == null) return false;
  // после полуночи (00–11) — продолжение вечера, не опоздание захода
  if (mins < 12 * 60) return false;
  return mins >= 21 * 60;
}

function dayMark(
  ymd: string,
  presentDays: Set<string>,
  lateDays: Set<string>,
  joinHm?: string
): DayMark {
  if (ymd < ATTENDANCE_CANON_START_YMD) return "outside";
  const today = todayYmdMsk();
  if (ymd > today) return "pending";
  if (!presentDays.has(ymd)) {
    if (ymd === today) return "pending";
    return "absent";
  }
  // Цвет = время на квадратике; lateDays — запасной источник
  if (isLateJoinHm(joinHm) || lateDays.has(ymd)) return "late";
  return "present";
}

function buildMonthGrid(year: number, month: number) {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const startDow = first.getUTCDay();
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
  presentDays: presentDaysProp,
  lateDays: lateDaysProp,
  visitBounds: visitBoundsProp,
  matchHistory = [],
}: Props) {
  const normalized = useMemo(() => normalizeSessions(sessions), [sessions]);
  const today = todayYmdMsk();
  const [ty, tm] = today.split("-").map(Number);
  const [canonY, canonM] = ATTENDANCE_CANON_START_YMD.split("-").map(Number);
  const [viewY, setViewY] = useState(ty);
  const [viewM, setViewM] = useState(tm);

  const marks = useMemo(() => {
    if (presentDaysProp !== undefined) {
      return {
        present: new Set(presentDaysProp),
        late: new Set(lateDaysProp || []),
      };
    }
    return trainingDayMarksFromSessions(normalized);
  }, [normalized, presentDaysProp, lateDaysProp]);

  const presentTrainingDays = marks.present;
  const lateTrainingDays = marks.late;

  const visitBounds = visitBoundsProp || {};

  const avgMin = useMemo(() => {
    if (!sessions30d) return 0;
    return Math.round(minutes30d / sessions30d);
  }, [minutes30d, sessions30d]);

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

  const presentInView = cells.filter((c) => {
    if (!c.ymd) return false;
    const joinHm = visitBounds[c.ymd]?.joinHm;
    const m = dayMark(c.ymd, presentTrainingDays, lateTrainingDays, joinHm);
    return m === "present" || m === "late";
  }).length;
  const absentInView = cells.filter((c) => {
    if (!c.ymd) return false;
    const joinHm = visitBounds[c.ymd]?.joinHm;
    return (
      dayMark(c.ymd, presentTrainingDays, lateTrainingDays, joinHm) === "absent"
    );
  }).length;

  return (
    <section className="card training-sessions-card">
      <h2>Посещаемость тренировок</h2>
      <p className="muted" style={{ marginTop: 6, marginBottom: 0 }}>
        TR1 — тренировка (вечер), PB1 — паблик. Учёт с 15.09.2026. «Был» =
        ≥{TRAINING_PRESENT_MIN_MINUTES} мин на TR1 в 21:00–00:00 МСК или уход
        ≥23:30 (после дропов). Заход до 21:00 — зелёный «был», с 21:00 — жёлтый.
      </p>

      <div className="training-stat-row">
        <div>
          <strong>{sessions30d}</strong>
          <span className="muted">вечеров / 30 дн</span>
        </div>
        <div>
          <strong>{minutes30d}</strong>
          <span className="muted">мин 21–00 / 30 дн</span>
        </div>
        <div>
          <strong>{avgMin || "—"}</strong>
          <span className="muted">сред. мин / вечер</span>
        </div>
        <div>
          <strong>{openNow ? "онлайн" : "—"}</strong>
          <span className="muted">сейчас на TR1</span>
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
              const bounds = c.ymd ? visitBounds[c.ymd] : undefined;
              const mark = dayMark(
                c.ymd,
                presentTrainingDays,
                lateTrainingDays,
                bounds?.joinHm
              );
              const timeLabel =
                bounds != null
                  ? `${bounds.joinHm}–${bounds.leaveHm ?? "…"}`
                  : null;
              return (
                <div
                  key={c.ymd}
                  className={`training-cal-cell mark-${mark}${
                    c.ymd === today ? " is-today" : ""
                  }`}
                  title={
                    mark === "present"
                      ? `Был (≥${TRAINING_PRESENT_MIN_MINUTES} мин или до конца)${
                          timeLabel ? ` · ${timeLabel}` : ""
                        }`
                      : mark === "late"
                        ? `Был, опоздал (заход с 21:00)${
                            timeLabel ? ` · ${timeLabel}` : ""
                          }`
                      : mark === "absent"
                        ? `Не был${timeLabel ? ` · ${timeLabel}` : ""}`
                        : mark === "pending"
                          ? "Ещё рано / окно не закрыто"
                          : "Вне учёта"
                  }
                >
                  <span className="training-cal-day">{c.day}</span>
                  {mark === "present" || mark === "late" ? (
                    <span className="training-cal-dot">был</span>
                  ) : mark === "absent" ? (
                    <span className="training-cal-dot">нет</span>
                  ) : (
                    <span className="training-cal-dot muted">·</span>
                  )}
                  {timeLabel &&
                  (mark === "present" ||
                    mark === "late" ||
                    mark === "absent") ? (
                    <span className="training-cal-times">{timeLabel}</span>
                  ) : null}
                </div>
              );
            })}
          </div>
          <p className="muted training-cal-legend">
            Зелёный — был, заход до 21:00 · жёлтый — был, заход с 21:00 · красный —
            не было · серый — ещё не считаем. «Был» = ≥
            {TRAINING_PRESENT_MIN_MINUTES} мин в 21:00–00:00 или уход ≥23:30.
            Мелким шрифтом заход (≥19:00) и итоговый выход (вылет ≤5 мин не
            считается). В этом месяце: <strong>{presentInView}</strong> был /{" "}
            <strong>{absentInView}</strong> нет
          </p>
        </div>
        <div className="training-chart-block">
          <h3>Среднее время на тренировке</h3>
          <p className="training-avg-big">
            {avgMin > 0 ? (
              <>
                <strong>{avgMin}</strong>
                <span>мин за вечер (21:00–00:00)</span>
              </>
            ) : (
              <span className="muted">Пока мало данных</span>
            )}
          </p>
          <p className="muted" style={{ margin: "8px 0 0", fontSize: "0.85rem" }}>
            Сумма за 30 дней в окне 21:00–00:00: {minutes30d} мин ·{" "}
            {sessions30d} вечеров (только TR1)
          </p>
        </div>
      </div>

      {matchHistory.length === 0 ? (
        <p className="muted" style={{ marginTop: 14 }}>
          Пока нет тренировочных матчей с ником в рейтинге — история PWR
          появится после оцифровки табло.
        </p>
      ) : (
        <div className="admin-table-wrap" style={{ marginTop: 14 }}>
          <h3 className="training-match-hist-title">
            История матчей · динамика PWR
          </h3>
          <table className="admin-table training-sessions-table training-match-hist-table">
            <thead>
              <tr>
                <th>Дата</th>
                <th>Время</th>
                <th>Карта</th>
                <th>Счёт</th>
                <th className="num">Δ PWR</th>
                <th className="num">PWR</th>
              </tr>
            </thead>
            <tbody>
              {matchHistory.map((m) => {
                const delta = m.pwrDelta;
                const deltaCls =
                  delta > 0
                    ? "pwr-delta plus"
                    : delta < 0
                      ? "pwr-delta minus"
                      : "pwr-delta zero";
                const deltaText =
                  delta > 0 ? `+${delta}` : String(delta);
                const score = `${m.factionA} ${m.ticketsA ?? "—"} : ${m.ticketsB ?? "—"} ${m.factionB}`;
                return (
                  <tr key={m.matchId}>
                    <td>{m.dateLabel}</td>
                    <td>{m.timeLabel}</td>
                    <td title={m.map}>
                      <span className="training-match-map">{m.map}</span>
                      {m.team && m.team !== "—" ? (
                        <span className="muted training-match-team">
                          {" "}
                          · {m.team}
                          {m.won === true
                            ? " W"
                            : m.won === false
                              ? " L"
                              : ""}
                        </span>
                      ) : null}
                    </td>
                    <td className="training-match-score">{score}</td>
                    <td className={`num ${deltaCls}`}>{deltaText}</td>
                    <td className="num">
                      <span
                        className={`home-pwr-badge rank-${m.rankKey}`}
                        title={m.rankLabel}
                        style={{ fontSize: "0.62rem", padding: "1px 5px" }}
                      >
                        {m.rankLabel}
                      </span>{" "}
                      {m.pwrAfter}
                    </td>
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
