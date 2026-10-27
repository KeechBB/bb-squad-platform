"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ATTENDANCE_CANON_START_YMD,
  trainingDayMarksFromSessions,
} from "@/lib/squadSessions";
import type { TrainMatchHistoryRow } from "@/lib/homeTrainPwr";
import { abbreviateFaction } from "@/lib/factionAbbrev";
import {
  ProfileMatchStatsModal,
  type MatchStatsOpen,
} from "@/components/ProfileMatchStatsModal";
import { ListPager, pageSlice } from "@/components/ListPager";
import { useFitPageSize } from "@/hooks/useFitPageSize";

/** UI fallback: Победа/Поражение из team↔winner или тикетов своей стороны. */
function deriveTrainResult(m: TrainMatchHistoryRow): boolean | null {
  if (m.won === true || m.won === false) return m.won;
  const team = String(m.team || "").trim();
  const winner = String(m.winner || "").trim();
  if (team && team !== "—" && winner && winner !== "—") {
    const t = abbreviateFaction(team).toUpperCase();
    const w = abbreviateFaction(winner).toUpperCase();
    if (t && w) return t === w || team.toUpperCase() === winner.toUpperCase();
  }
  const ta = m.ticketsA;
  const tb = m.ticketsB;
  if (
    team &&
    team !== "—" &&
    ta != null &&
    tb != null &&
    Number.isFinite(ta) &&
    Number.isFinite(tb) &&
    ta !== tb
  ) {
    const t = abbreviateFaction(team).toUpperCase();
    const a = abbreviateFaction(m.factionA).toUpperCase();
    const b = abbreviateFaction(m.factionB).toUpperCase();
    if (t && a && t === a) return ta > tb;
    if (t && b && t === b) return tb > ta;
  }
  return null;
}

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
  dayOffDays?: string[];
  visitBounds?: Record<string, { joinHm: string; leaveHm: string | null }>;
};

type Props = AttendanceLaneProps & {
  /** История тренировочных матчей с ΔRP */
  matchHistory?: TrainMatchHistoryRow[];
  /** false — только посещаемость; историю выносим в отдельный блок */
  includeMatchHistory?: boolean;
  /**
   * Лента TR2. Если передана — на календаре TR1 | TR2 (| PB1).
   */
  tr2Lane?: AttendanceLaneProps;
  /**
   * Лента PB1. Если передана — на календаре кнопка PB1 рядом с TR*.
   */
  publicLane?: AttendanceLaneProps;
  /** Выходной / резерв — блок над календарём */
  absenceSlot?: ReactNode;
  /** Синхрон с режимом профиля (паб/трени) */
  preferredServer?: "TR1" | "TR2" | "PB1";
  /** Скрыть TR1/TR2/PB1 — режим уже выбран снаружи */
  hideServerToggle?: boolean;
  /** Режим КВ: календарь был/не был + лого соперника */
  cwMode?: boolean;
  cwByDay?: Record<
    string,
    {
      present: boolean;
      /** win/lose встречи клана — отдельно от был/не был */
      result?: "win" | "lose" | null;
      opp: string;
      logoUrl: string | null;
      map?: string;
    }
  >;
  /** Скрыть блок минут/вечеров — больше места под календарь */
  hideStatRow?: boolean;
};

type TrainServer = "TR1" | "TR2" | "PB1";

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

type DayMark =
  | "present"
  | "late"
  | "absent"
  | "reserve"
  | "dayoff"
  | "pending"
  | "outside";

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
  dayOffDays: Set<string>,
  joinHm?: string
): DayMark {
  if (ymd < ATTENDANCE_CANON_START_YMD) return "outside";
  const today = todayYmdMsk();
  // Выходной / резерв — заранее на будущие дни своим цветом
  if (dayOffDays.has(ymd)) return "dayoff";
  if (reserveDays.has(ymd)) return "reserve";
  if (ymd > today) return "pending";
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
  title = "История матчей тренировок",
  hideTitle = false,
}: {
  matchHistory?: TrainMatchHistoryRow[];
  highlightNick?: string;
  title?: string;
  /** когда снаружи уже вкладки */
  hideTitle?: boolean;
}) {
  const [open, setOpen] = useState<MatchStatsOpen | null>(null);
  const [page, setPage] = useState(1);
  const tableWrapRef = useRef<HTMLDivElement | null>(null);
  const pageSize = useFitPageSize(tableWrapRef);
  const sliced = pageSlice(matchHistory, page, pageSize);

  useEffect(() => {
    setPage(1);
  }, [matchHistory.length, pageSize]);

  return (
    <section className="card profile-hist-card profile-train-hist-card profile-hist-paged">
      {hideTitle ? null : (
        <h2 className="profile-hist-title">{title}</h2>
      )}
      {matchHistory.length === 0 ? (
        <p className="muted" style={{ margin: "8px 0 0" }}>
          Пока нет тренировочных матчей с 20.10 — история появится
          после каток, где ник есть в стате.
        </p>
      ) : (
        <>
        <div
          ref={tableWrapRef}
          className="admin-table-wrap profile-hist-table-wrap"
        >
          <table className="admin-table training-sessions-table training-match-hist-table">
            <thead>
              <tr>
                <th>Дата</th>
                <th>Карта</th>
                <th>Счёт</th>
                <th>Результат</th>
                <th className="num">Ресы</th>
                <th className="num">Ноки</th>
                <th className="num">Килы</th>
                <th className="num">Смерти</th>
              </tr>
            </thead>
            <tbody>
              {sliced.rows.map((m) => {
                const score = `${abbreviateFaction(m.factionA)} ${m.ticketsA ?? "—"} : ${m.ticketsB ?? "—"} ${abbreviateFaction(m.factionB)}`;
                const wonUi = deriveTrainResult(m);
                const resultCls =
                  wonUi === true
                    ? "kv-pill win"
                    : wonUi === false
                      ? "kv-pill lose"
                      : "kv-pill";
                const resultText =
                  wonUi === true
                    ? "Победа"
                    : wonUi === false
                      ? "Поражение"
                      : "—";
                const canOpen = Boolean(m.playersUrl);
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
                          `${abbreviateFaction(m.factionA)} ${m.ticketsA ?? "—"}`,
                          `${abbreviateFaction(m.factionB)} ${m.ticketsB ?? "—"}`,
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
                    <td>
                      <span className={resultCls}>{resultText}</span>
                    </td>
                    <td className="num">{Number(m.res) || 0}</td>
                    <td className="num">{Number(m.nok) || 0}</td>
                    <td className="num">{Number(m.kills) || 0}</td>
                    <td className="num">{Number(m.deaths) || 0}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <ListPager
          page={sliced.page}
          pageCount={sliced.pageCount}
          total={sliced.total}
          pageSize={pageSize}
          onChange={setPage}
          maxButtons={10}
          label="Страницы истории тренировок"
          className="profile-hist-pager"
        />
        </>
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
  dayOffDays: dayOffDaysProp,
  visitBounds: visitBoundsProp,
  matchHistory = [],
  includeMatchHistory = true,
  tr2Lane,
  publicLane,
  absenceSlot,
  preferredServer,
  hideServerToggle = false,
  cwMode = false,
  cwByDay = {},
  hideStatRow = false,
}: Props) {
  const [server, setServer] = useState<TrainServer>(
    preferredServer || "TR1"
  );
  useEffect(() => {
    if (!preferredServer) return;
    if (preferredServer === "PB1" && !publicLane) return;
    if (preferredServer === "TR2" && !tr2Lane) return;
    setServer(preferredServer);
  }, [preferredServer, publicLane, tr2Lane]);
  const hasTr2 = Boolean(tr2Lane);
  const hasPublic = Boolean(publicLane);
  const showToggle = !hideServerToggle && (hasTr2 || hasPublic);
  const tr1Lane: AttendanceLaneProps = {
    sessions,
    minutes30d,
    sessions30d,
    openNow,
    presentDays: presentDaysProp,
    lateDays: lateDaysProp,
    reserveDays: reserveDaysProp,
    dayOffDays: dayOffDaysProp,
    visitBounds: visitBoundsProp,
  };
  const lane =
    server === "PB1" && publicLane
      ? publicLane
      : server === "TR2" && tr2Lane
        ? tr2Lane
        : tr1Lane;

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
  const dayOffTrainingDays = useMemo(
    () => new Set(server === "TR1" ? lane.dayOffDays || [] : []),
    [lane.dayOffDays, server]
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
  const isTr2 = server === "TR2";
  const title = cwMode
    ? "Посещаемость КВ"
    : isPb1
      ? "Посещаемость паблика"
      : "Посещаемость тренировок";
  const daysLabel = isPb1 ? "дней / 30 дн" : "вечеров / 30 дн";
  const minutesLabel = isPb1
    ? "мин на PB1 / 30 дн"
    : isTr2
      ? "мин 21–00 / 30 дн · TR2"
      : "мин 21–00 / 30 дн · TR1";
  const avgLabel = isPb1 ? "сред. мин / день" : "сред. мин / вечер";
  const onlineLabel = isPb1
    ? "сейчас на PB1"
    : isTr2
      ? "сейчас на TR2"
      : "сейчас на TR1";
  const calendarTitle = cwMode
    ? "Календарь КВ"
    : isPb1
      ? "Календарь паблика (PB1)"
      : isTr2
        ? "Календарь тренировок (TR2)"
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

  const serverToggle = showToggle ? (
    <div
      className="training-server-toggle"
      role="group"
      aria-label="Сервер календаря"
    >
      <button
        type="button"
        className={`btn ghost${server === "TR1" ? " active" : ""}`}
        aria-pressed={server === "TR1"}
        onClick={() => setServer("TR1")}
        title="Тренировка TR1"
      >
        TR1
      </button>
      {hasTr2 ? (
        <button
          type="button"
          className={`btn ghost${server === "TR2" ? " active" : ""}`}
          aria-pressed={server === "TR2"}
          onClick={() => setServer("TR2")}
          title="Тренировка TR2"
        >
          TR2
        </button>
      ) : null}
      {hasPublic ? (
        <button
          type="button"
          className={`btn ghost${server === "PB1" ? " active" : ""}`}
          aria-pressed={server === "PB1"}
          onClick={() => setServer("PB1")}
          title="Паблик PB1"
        >
          PB1
        </button>
      ) : null}
    </div>
  ) : null;

  return (
    <section className="card training-sessions-card">
      <div className="training-sessions-head">
        <h2>{title}</h2>
        {serverToggle}
      </div>

      {absenceSlot ? (
        <div className="training-absence-slot">{absenceSlot}</div>
      ) : null}

      {!hideStatRow && !cwMode ? (
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
      ) : null}

      <div className="training-charts training-charts-cal-only">
        <div className="training-chart-block training-cal-block">
          <div className="training-cal-head">
            <div className="training-cal-head-left">
              <h3>{calendarTitle}</h3>
              {cwMode ? null : serverToggle}
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

              if (cwMode) {
                const cw = cwByDay[c.ymd];
                const isDayOff = dayOffTrainingDays.has(c.ymd);
                const isReserve = reserveTrainingDays.has(c.ymd);
                let mark = "nokv";
                let label = "нет кв";
                let title = "В этот день КВ не было";
                if (isDayOff) {
                  mark = "dayoff";
                  label = "вых";
                  title = "Выходной (1–3 дня)";
                } else if (isReserve) {
                  mark = "reserve";
                  label = "резерв";
                  title = "Резерв (от 4 дней)";
                } else if (cw) {
                  mark = cw.present ? "cw-present" : "cw-absent";
                  label = cw.present ? "был" : "не был";
                  const res =
                    cw.result === "win"
                      ? "win"
                      : cw.result === "lose"
                        ? "lose"
                        : null;
                  const resLabel =
                    res === "win" ? "победа" : res === "lose" ? "поражение" : "";
                  title = [
                    cw.present ? "Был" : "Не был",
                    resLabel,
                    `vs ${cw.opp}`,
                    cw.map || "",
                  ]
                    .filter(Boolean)
                    .join(" · ");
                  return (
                    <div
                      key={c.ymd}
                      className={`training-cal-cell training-cal-cell-cw mark-${mark}${
                        res ? ` result-${res}` : ""
                      }${c.ymd === today ? " is-today" : ""}`}
                      title={title}
                    >
                      <div className="training-cal-cw-text">
                        <span className="training-cal-day">{c.day}</span>
                        {res ? (
                          <span
                            className={`training-cal-cw-result is-${res}`}
                            aria-label={resLabel}
                          >
                            {res === "win" ? "W" : "L"}
                          </span>
                        ) : null}
                        <span className="training-cal-dot">{label}</span>
                      </div>
                      {cw.logoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          className="training-cal-opp-logo"
                          src={cw.logoUrl}
                          alt=""
                          width={64}
                          height={64}
                        />
                      ) : null}
                    </div>
                  );
                }
                return (
                  <div
                    key={c.ymd}
                    className={`training-cal-cell training-cal-cell-cw mark-${mark}${
                      c.ymd === today ? " is-today" : ""
                    }`}
                    title={title}
                  >
                    <div className="training-cal-cw-text">
                      <span className="training-cal-day">{c.day}</span>
                      <span className="training-cal-dot">{label}</span>
                    </div>
                  </div>
                );
              }

              const bounds = c.ymd ? visitBounds[c.ymd] : undefined;
              const mark = dayMark(
                c.ymd,
                presentTrainingDays,
                lateTrainingDays,
                reserveTrainingDays,
                dayOffTrainingDays,
                bounds?.joinHm
              );
              const timeLabel =
                bounds != null
                  ? `${bounds.joinHm}–${bounds.leaveHm ?? "…"}`
                  : null;
              const showTime =
                Boolean(timeLabel) &&
                (mark === "present" || mark === "late" || mark === "absent");
              return (
                <div
                  key={c.ymd}
                  className={`training-cal-cell training-cal-cell-attend mark-${mark}${
                    c.ymd === today ? " is-today" : ""
                  }`}
                  title={
                    mark === "present"
                      ? `Был${timeLabel ? ` · ${timeLabel}` : ""}`
                      : mark === "late"
                        ? `Был, опоздал (заход с 21:00)${
                            timeLabel ? ` · ${timeLabel}` : ""
                          }`
                        : mark === "dayoff"
                          ? "Выходной (1–3 дня)"
                          : mark === "reserve"
                            ? "Резерв (от 4 дней)"
                            : mark === "absent"
                              ? `Не был${timeLabel ? ` · ${timeLabel}` : ""}`
                              : mark === "pending"
                                ? "Ещё рано / окно не закрыто"
                                : "Вне учёта"
                  }
                >
                  <span className="training-cal-day">{c.day}</span>
                  {showTime ? (
                    <span className="training-cal-times">{timeLabel}</span>
                  ) : null}
                  {mark === "present" ? (
                    <span className="training-cal-dot">был</span>
                  ) : mark === "late" ? (
                    <span className="training-cal-dot">опоздал</span>
                  ) : mark === "dayoff" ? (
                    <span className="training-cal-dot">вых</span>
                  ) : mark === "reserve" ? (
                    <span className="training-cal-dot">резерв</span>
                  ) : mark === "absent" ? (
                    <span className="training-cal-dot">не был</span>
                  ) : (
                    <span className="training-cal-dot muted">·</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {includeMatchHistory ? (
        matchHistory.length === 0 ? (
          <p className="muted" style={{ marginTop: 14 }}>
            Пока нет тренировочных матчей с ником в рейтинге — история
            появится после каток со статой.
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
                  <th>Результат</th>
                  <th className="num">Ресы</th>
                  <th className="num">Ноки</th>
                  <th className="num">Килы</th>
                  <th className="num">Смерти</th>
                </tr>
              </thead>
              <tbody>
                {matchHistory.map((m) => {
                  const score = `${abbreviateFaction(m.factionA)} ${m.ticketsA ?? "—"} : ${m.ticketsB ?? "—"} ${abbreviateFaction(m.factionB)}`;
                  const wonUi = deriveTrainResult(m);
                  const resultCls =
                    wonUi === true
                      ? "kv-pill win"
                      : wonUi === false
                        ? "kv-pill lose"
                        : "kv-pill";
                  const resultText =
                    wonUi === true
                      ? "Победа"
                      : wonUi === false
                        ? "Поражение"
                        : "—";
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
                      <td>
                        <span className={resultCls}>{resultText}</span>
                      </td>
                      <td className="num">{Number(m.res) || 0}</td>
                      <td className="num">{Number(m.nok) || 0}</td>
                      <td className="num">{Number(m.kills) || 0}</td>
                      <td className="num">{Number(m.deaths) || 0}</td>
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
