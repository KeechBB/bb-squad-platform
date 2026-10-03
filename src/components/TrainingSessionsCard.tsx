"use client";

import { useMemo, useState } from "react";
import {
  ATTENDANCE_CANON_START_YMD,
  TRAINING_PRESENT_MIN_MINUTES,
  trainingDayMarksFromSessions,
} from "@/lib/squadSessions";
import type { TrainMatchHistoryRow } from "@/lib/homeTrainPwr";
import {
  ProfileMatchStatsModal,
  type MatchStatsOpen,
} from "@/components/ProfileMatchStatsModal";

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

export type AttendanceLaneProps = {
  sessions: SessionRow[];
  minutes30d: number;
  sessions30d: number;
  openNow: boolean;
  presentDays?: string[];
  lateDays?: string[];
  reserveDays?: string[];
  visitBounds?: Record<string, { joinHm: string; leaveHm: string | null }>;
};

type Props = AttendanceLaneProps & {
  /** История тренировочных матчей с ΔRP */
  matchHistory?: TrainMatchHistoryRow[];
  /** false — только посещаемость; историю выносим в отдельный блок */
  includeMatchHistory?: boolean;
  /**
   * Вторая лента (PB1). Если передана — на календаре кнопка TR1 | PB1
   * (по умолчанию TR1, как раньше).
   */
  publicLane?: AttendanceLaneProps;
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

type DayMark = "present" | "late" | "absent" | "reserve" | "pending" | "outside";

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
  reserveDays: Set<string>,
  joinHm?: string
): DayMark {
  if (ymd < ATTENDANCE_CANON_START_YMD) return "outside";
  const today = todayYmdMsk();
  if (ymd > today) return "pending";
  // Резерв — уваж. причина: синий «резерв», даже если заходил
  if (reserveDays.has(ymd)) return "reserve";
  if (presentDays.has(ymd)) {
    if (isLateJoinHm(joinHm) || lateDays.has(ymd)) return "late";
    return "present";
  }
  if (ymd === today) return "pending";
  return "absent";
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

export function TrainingMatchHistory({
  matchHistory = [],
  highlightNick,
}: {
  matchHistory?: TrainMatchHistoryRow[];
  highlightNick?: string;
}) {
  const [open, setOpen] = useState<MatchStatsOpen | null>(null);

  return (
    <section className="card profile-hist-card profile-train-hist-card">
      <h2 className="profile-hist-title">История матчей тренировок</h2>
      {matchHistory.length === 0 ? (
        <p className="muted" style={{ margin: "8px 0 0" }}>
          Пока нет тренировочных матчей с ником в рейтинге — история RP
          появится после каток с give-up киллами.
        </p>
      ) : (
        <div className="admin-table-wrap profile-hist-table-wrap">
          <table className="admin-table training-sessions-table training-match-hist-table">
            <thead>
              <tr>
                <th>Дата</th>
                <th>Карта</th>
                <th>Счёт</th>
                <th className="num">Δ RP</th>
                <th>Результат</th>
                <th className="num">RP</th>
              </tr>
            </thead>
            <tbody>
              {matchHistory.map((m) => {
                const delta = m.rpDelta;
                const deltaCls =
                  delta == null
                    ? "pwr-delta zero"
                    : delta > 0
                      ? "pwr-delta plus"
                      : delta < 0
                        ? "pwr-delta minus"
                        : "pwr-delta zero";
                const deltaText =
                  delta == null
                    ? "—"
                    : delta > 0
                      ? `+${delta}`
                      : String(delta);
                const score = `${m.factionA} ${m.ticketsA ?? "—"} : ${m.ticketsB ?? "—"} ${m.factionB}`;
                const resultCls =
                  m.won === true
                    ? "kv-pill win"
                    : m.won === false
                      ? "kv-pill lose"
                      : "kv-pill";
                const resultText =
                  m.won === true
                    ? "Победа"
                    : m.won === false
                      ? "Поражение"
                      : "—";
                const canOpen = Boolean(m.playersUrl);
                const rpAfter = m.rpAfter;
                return (
                  <tr
                    key={m.matchId}
                    className={canOpen ? "profile-hist-row-click" : undefined}
                    tabIndex={canOpen ? 0 : undefined}
                    onClick={() => {
                      if (!canOpen) return;
                      setOpen({
                        kind: "train",
                        matchId: m.matchId,
                        title: `${m.dateLabel} · ${m.map || "тренировка"}`,
                        sub: [
                          `${m.factionA} ${m.ticketsA ?? "—"}`,
                          `${m.factionB} ${m.ticketsB ?? "—"}`,
                          m.winner ? `победа ${m.winner}` : null,
                          m.duration ? `время ${m.duration}` : null,
                          m.server,
                        ]
                          .filter(Boolean)
                          .join(" · "),
                        playersUrl: m.playersUrl,
                        factionA: m.factionA,
                        ticketsA: m.ticketsA,
                        factionB: m.factionB,
                        ticketsB: m.ticketsB,
                        winner: m.winner,
                        duration: m.duration,
                        highlightNick,
                      });
                    }}
                    onKeyDown={(e) => {
                      if (!canOpen) return;
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        (e.currentTarget as HTMLTableRowElement).click();
                      }
                    }}
                  >
                    <td>{m.dateLabel}</td>
                    <td
                      title={[m.map, m.team && m.team !== "—" ? m.team : ""]
                        .filter(Boolean)
                        .join(" · ")}
                    >
                      <span className="training-match-map">{m.map}</span>
                    </td>
                    <td className="training-match-score" title={score}>
                      {score}
                    </td>
                    <td className={`num ${deltaCls}`}>{deltaText}</td>
                    <td>
                      <span className={resultCls}>{resultText}</span>
                    </td>
                    <td
                      className="num"
                      title={
                        rpAfter != null
                          ? `${m.rankLabel} · ${rpAfter}`
                          : "RP ещё не считался"
                      }
                    >
                      {rpAfter != null ? (
                        <span className="profile-hist-pwr">
                          <span
                            className={`home-pwr-badge rank-${m.rankKey}`}
                          >
                            {m.rankLabel}
                          </span>
                          <span className="profile-hist-pwr-n">{rpAfter}</span>
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <ProfileMatchStatsModal open={open} onClose={() => setOpen(null)} />
    </section>
  );
}

export function TrainingSessionsCard({
  sessions,
  minutes30d,
  sessions30d,
  openNow,
  presentDays: presentDaysProp,
  lateDays: lateDaysProp,
  reserveDays: reserveDaysProp,
  visitBounds: visitBoundsProp,
  matchHistory = [],
  includeMatchHistory = true,
  publicLane,
}: Props) {
  const [server, setServer] = useState<"TR1" | "PB1">("TR1");
  const hasPublic = Boolean(publicLane);
  const lane =
    server === "PB1" && publicLane
      ? publicLane
      : {
          sessions,
          minutes30d,
          sessions30d,
          openNow,
          presentDays: presentDaysProp,
          lateDays: lateDaysProp,
          reserveDays: reserveDaysProp,
          visitBounds: visitBoundsProp,
        };

  const normalized = useMemo(
    () => normalizeSessions(lane.sessions),
    [lane.sessions]
  );
  const today = todayYmdMsk();
  const [ty, tm] = today.split("-").map(Number);
  const [canonY, canonM] = ATTENDANCE_CANON_START_YMD.split("-").map(Number);
  const [viewY, setViewY] = useState(ty);
  const [viewM, setViewM] = useState(tm);

  const marks = useMemo(() => {
    if (lane.presentDays !== undefined) {
      return {
        present: new Set(lane.presentDays),
        late: new Set(lane.lateDays || []),
      };
    }
    return trainingDayMarksFromSessions(normalized);
  }, [normalized, lane.presentDays, lane.lateDays]);

  const presentTrainingDays = marks.present;
  const lateTrainingDays = marks.late;
  const reserveTrainingDays = useMemo(
    () => new Set(server === "TR1" ? lane.reserveDays || [] : []),
    [lane.reserveDays, server]
  );

  const visitBounds = lane.visitBounds || {};
  const activeMinutes = lane.minutes30d;
  const activeSessions30d = lane.sessions30d;
  const activeOpenNow = lane.openNow;

  const avgMin = useMemo(() => {
    if (!activeSessions30d) return 0;
    return Math.round(activeMinutes / activeSessions30d);
  }, [activeMinutes, activeSessions30d]);

  const isPb1 = server === "PB1";
  const title = isPb1 ? "Посещаемость паблика" : "Посещаемость тренировок";
  const daysLabel = isPb1 ? "дней / 30 дн" : "вечеров / 30 дн";
  const minutesLabel = isPb1 ? "мин на PB1 / 30 дн" : "мин 21–00 / 30 дн";
  const avgLabel = isPb1 ? "сред. мин / день" : "сред. мин / вечер";
  const onlineLabel = isPb1 ? "сейчас на PB1" : "сейчас на TR1";
  const calendarTitle = isPb1
    ? "Календарь паблика (PB1)"
    : "Календарь тренировок (TR1)";

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

  const serverToggle = hasPublic ? (
    <div
      className="training-server-toggle"
      role="group"
      aria-label="Сервер календаря"
    >
      <button
        type="button"
        className={`btn ghost${!isPb1 ? " active" : ""}`}
        aria-pressed={!isPb1}
        onClick={() => setServer("TR1")}
        title="Тренировка TR1"
      >
        TR1
      </button>
      <button
        type="button"
        className={`btn ghost${isPb1 ? " active" : ""}`}
        aria-pressed={isPb1}
        onClick={() => setServer("PB1")}
        title="Паблик PB1"
      >
        PB1
      </button>
    </div>
  ) : null;

  return (
    <section className="card training-sessions-card">
      <div className="training-sessions-head">
        <h2>{title}</h2>
        {serverToggle}
      </div>

      <div className="training-stat-row">
        <div>
          <strong>{activeSessions30d}</strong>
          <span className="muted">{daysLabel}</span>
        </div>
        <div>
          <strong>{activeMinutes}</strong>
          <span className="muted">{minutesLabel}</span>
        </div>
        <div>
          <strong>{avgMin || "—"}</strong>
          <span className="muted">{avgLabel}</span>
        </div>
        <div>
          <strong>{activeOpenNow ? "онлайн" : "—"}</strong>
          <span className="muted">{onlineLabel}</span>
        </div>
      </div>

      <div className="training-charts training-charts-cal-only">
        <div className="training-chart-block training-cal-block">
          <div className="training-cal-head">
            <div className="training-cal-head-left">
              <h3>{calendarTitle}</h3>
              {serverToggle}
            </div>
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
                reserveTrainingDays,
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
                        : mark === "reserve"
                          ? "Резерв (уважительная причина)"
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
                  ) : mark === "reserve" ? (
                    <span className="training-cal-dot">резерв</span>
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
        </div>
      </div>

      {includeMatchHistory ? (
        matchHistory.length === 0 ? (
          <p className="muted" style={{ marginTop: 14 }}>
            Пока нет тренировочных матчей с ником в рейтинге — история RP
            появится после каток с give-up киллами.
          </p>
        ) : (
          <div className="admin-table-wrap" style={{ marginTop: 14 }}>
            <h3 className="training-match-hist-title">
              История матчей тренировок
            </h3>
            <table className="admin-table training-sessions-table training-match-hist-table">
              <thead>
                <tr>
                  <th>Дата</th>
                  <th>Карта</th>
                  <th>Счёт</th>
                  <th className="num">Δ RP</th>
                  <th>Результат</th>
                  <th className="num">RP</th>
                </tr>
              </thead>
              <tbody>
                {matchHistory.map((m) => {
                  const delta = m.rpDelta;
                  const deltaCls =
                    delta == null
                      ? "pwr-delta zero"
                      : delta > 0
                        ? "pwr-delta plus"
                        : delta < 0
                          ? "pwr-delta minus"
                          : "pwr-delta zero";
                  const deltaText =
                    delta == null
                      ? "—"
                      : delta > 0
                        ? `+${delta}`
                        : String(delta);
                  const score = `${m.factionA} ${m.ticketsA ?? "—"} : ${m.ticketsB ?? "—"} ${m.factionB}`;
                  const resultCls =
                    m.won === true
                      ? "kv-pill win"
                      : m.won === false
                        ? "kv-pill lose"
                        : "kv-pill";
                  const resultText =
                    m.won === true
                      ? "Победа"
                      : m.won === false
                        ? "Поражение"
                        : "—";
                  const rpAfter = m.rpAfter;
                  return (
                    <tr key={m.matchId}>
                      <td>{m.dateLabel}</td>
                      <td title={m.map}>
                        <span className="training-match-map">{m.map}</span>
                        {m.team && m.team !== "—" ? (
                          <span className="muted training-match-team">
                            {" "}
                            · {m.team}
                          </span>
                        ) : null}
                      </td>
                      <td className="training-match-score">{score}</td>
                      <td className={`num ${deltaCls}`}>{deltaText}</td>
                      <td>
                        <span className={resultCls}>{resultText}</span>
                      </td>
                      <td className="num">
                        {rpAfter != null ? (
                          <>
                            <span
                              className={`home-pwr-badge rank-${m.rankKey}`}
                              title={m.rankLabel}
                              style={{ fontSize: "0.62rem", padding: "1px 5px" }}
                            >
                              {m.rankLabel}
                            </span>{" "}
                            {rpAfter}
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      ) : null}
    </section>
  );
}
