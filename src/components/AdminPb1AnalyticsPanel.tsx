"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type HourBucket = {
  hour: number;
  total: number;
  players: number;
  staff: number;
};

type Scope = "day" | "week" | "month" | "year";

type Payload = {
  scope: Scope;
  key: string;
  label: string;
  range: { fromYmd: string; toYmd: string };
  timeline: HourBucket[];
  timelineMode: "absolute" | "average";
  daysWithData: number;
  stats: {
    uniqueSteamIds: number;
    uniqueSteamIdsDay: number;
    uniqueSteamIdsWeek: number;
    uniqueSteamIdsMonth: number;
    newSteamIdsDay: number;
    newSteamIdsWeek: number;
    newSteamIdsMonth: number;
    wakeAvgWeek: string | null;
    wakeAvgMonth: string | null;
    peakHourUnique: number;
    peakHour: number;
    playerHours: number;
    avgSessionMin: number | null;
    busyHour: number;
    quietHour: number;
  };
  updatedAt: string;
};

function mskTodayYmd() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function pad2(n: number) {
  return n < 10 ? `0${n}` : String(n);
}

const MONTHS_RU = [
  "Январь",
  "Февраль",
  "Март",
  "Апрель",
  "Май",
  "Июнь",
  "Июль",
  "Август",
  "Сентябрь",
  "Октябрь",
  "Ноябрь",
  "Декабрь",
];

function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <div className="pb1a-stat" role="listitem">
      <span className="pb1a-stat-label">{label}</span>
      <strong className="pb1a-stat-value">{value}</strong>
      {hint ? <span className="pb1a-stat-hint">{hint}</span> : null}
    </div>
  );
}

function TimelineChart({
  hours,
  mode,
}: {
  hours: HourBucket[];
  mode: "absolute" | "average";
}) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...hours.map((h) => h.total));

  return (
    <div className="pb1a-chart">
      <div className="pb1a-chart-legend">
        <span className="pb1a-leg pb1a-leg-player">игроки</span>
        <span className="pb1a-leg pb1a-leg-staff">админы / моды</span>
        <span className="pb1a-chart-mode">
          {mode === "average" ? "среднее по дням периода" : "уникальные за час"}
        </span>
      </div>
      <div className="pb1a-chart-bars" role="img" aria-label="Онлайн по часам МСК">
        {hours.map((h) => {
          const pct = (h.total / max) * 100;
          const staffPct = h.total > 0 ? (h.staff / h.total) * 100 : 0;
          const playerPct = 100 - staffPct;
          const active = hover === h.hour;
          return (
            <button
              key={h.hour}
              type="button"
              className={`pb1a-bar${active ? " is-hover" : ""}`}
              style={{ ["--bar-h" as string]: `${Math.max(pct, h.total > 0 ? 4 : 0)}%` }}
              onMouseEnter={() => setHover(h.hour)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(h.hour)}
              onBlur={() => setHover(null)}
              title={`${pad2(h.hour)}:00 — всего ${h.total}, игроки ${h.players}, staff ${h.staff}`}
            >
              <span className="pb1a-bar-num">{Math.round(h.total)}</span>
              <span className="pb1a-bar-stack">
                <span
                  className="pb1a-bar-staff"
                  style={{ height: `${staffPct}%` }}
                />
                <span
                  className="pb1a-bar-player"
                  style={{ height: `${playerPct}%` }}
                />
              </span>
              <span className="pb1a-bar-label">{pad2(h.hour)}</span>
            </button>
          );
        })}
      </div>
      {hover != null ? (
        <div className="pb1a-chart-tip">
          <strong>{pad2(hover)}:00–{pad2(hover)}:59 МСК</strong>
          {" · всего "}
          {hours[hover]?.total ?? 0}
          {" · игроки "}
          {hours[hover]?.players ?? 0}
          {" · админы/моды "}
          {hours[hover]?.staff ?? 0}
        </div>
      ) : (
        <div className="pb1a-chart-tip muted">
          Наведи на час — подсветка и разбивка
        </div>
      )}
    </div>
  );
}

export function AdminPb1AnalyticsPanel() {
  const today = useMemo(() => mskTodayYmd(), []);
  const [scope, setScope] = useState<Scope>("day");
  const [dayKey, setDayKey] = useState(today);
  const [monthKey, setMonthKey] = useState(today.slice(0, 7));
  const [yearKey, setYearKey] = useState(today.slice(0, 4));
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const requestKey = useMemo(() => {
    if (scope === "month") return monthKey;
    if (scope === "year") return yearKey;
    return dayKey;
  }, [scope, dayKey, monthKey, yearKey]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const qs = new URLSearchParams({ scope, key: requestKey });
      const res = await fetch(`/api/admin/pb1-analytics?${qs}`, {
        cache: "no-store",
      });
      const json = (await res.json().catch(() => ({}))) as Payload & {
        error?: string;
      };
      if (!res.ok) {
        setError(json.error || "Ошибка загрузки");
        setData(null);
        return;
      }
      setData(json);
    } catch {
      setError("Сеть недоступна");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [scope, requestKey]);

  useEffect(() => {
    void load();
  }, [load]);

  const years = useMemo(() => {
    const y = Number(today.slice(0, 4));
    return [y, y - 1, y - 2];
  }, [today]);

  return (
    <section className="pb1a">
      <header className="pb1a-head">
        <div>
          <h2 className="pb1a-title">Аналитика PB1</h2>
          <p className="muted pb1a-sub">
            Онлайн паблика (TPUB1/PB1), календарь МСК. Админы/моды сайта — красным.
          </p>
        </div>
        <button type="button" className="btn" disabled={loading} onClick={() => void load()}>
          {loading ? "Считаю…" : "Обновить"}
        </button>
      </header>

      <div className="pb1a-filters" role="toolbar" aria-label="Период">
        <div className="pb1a-scope">
          {(
            [
              ["day", "День"],
              ["week", "Неделя"],
              ["month", "Месяц"],
              ["year", "Год"],
            ] as const
          ).map(([id, lab]) => (
            <button
              key={id}
              type="button"
              className={`btn pb1a-scope-btn${scope === id ? " primary" : ""}`}
              onClick={() => setScope(id)}
            >
              {lab}
            </button>
          ))}
        </div>

        {scope === "day" || scope === "week" ? (
          <label className="pb1a-field">
            <span>{scope === "week" ? "День в неделе" : "Дата"}</span>
            <input
              type="date"
              value={dayKey}
              max={today}
              onChange={(e) => setDayKey(e.target.value || today)}
            />
          </label>
        ) : null}

        {scope === "month" ? (
          <label className="pb1a-field">
            <span>Месяц</span>
            <input
              type="month"
              value={monthKey}
              max={today.slice(0, 7)}
              onChange={(e) => setMonthKey(e.target.value || today.slice(0, 7))}
            />
          </label>
        ) : null}

        {scope === "year" ? (
          <label className="pb1a-field">
            <span>Год</span>
            <select
              value={yearKey}
              onChange={(e) => setYearKey(e.target.value)}
            >
              {years.map((y) => (
                <option key={y} value={String(y)}>
                  {y}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {scope === "month" ? (
          <div className="pb1a-month-chips">
            {MONTHS_RU.map((name, i) => {
              const ym = `${yearKey || today.slice(0, 4)}-${pad2(i + 1)}`;
              const disabled = ym > today.slice(0, 7);
              return (
                <button
                  key={name}
                  type="button"
                  className={`pb1a-chip${monthKey === ym ? " is-on" : ""}`}
                  disabled={disabled}
                  onClick={() => {
                    setYearKey(ym.slice(0, 4));
                    setMonthKey(ym);
                    setScope("month");
                  }}
                >
                  {name}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>

      {error ? <p className="error">{error}</p> : null}

      {data ? (
        <>
          <div className="pb1a-period-line">
            <strong>{data.label}</strong>
            <span className="muted">
              {" "}
              · {data.range.fromYmd} → {data.range.toYmd} · дней с онлайном:{" "}
              {data.daysWithData}
            </span>
          </div>

          <TimelineChart hours={data.timeline} mode={data.timelineMode} />

          <h3 className="pb1a-block-title">Уникальные и новые Steam ID</h3>
          <div className="pb1a-stats" role="list">
            <StatCard
              label="Уникальных за день"
              value={data.stats.uniqueSteamIdsDay}
              hint="календарный день якоря"
            />
            <StatCard
              label="Уникальных за неделю"
              value={data.stats.uniqueSteamIdsWeek}
              hint="пн–вс МСК"
            />
            <StatCard
              label="Уникальных за месяц"
              value={data.stats.uniqueSteamIdsMonth}
              hint="календарный месяц"
            />
            <StatCard
              label="Новых за день"
              value={data.stats.newSteamIdsDay}
              hint="первый заход на PB1"
            />
            <StatCard
              label="Новых за неделю"
              value={data.stats.newSteamIdsWeek}
            />
            <StatCard
              label="Новых за месяц"
              value={data.stats.newSteamIdsMonth}
            />
          </div>

          <h3 className="pb1a-block-title">Подъём сервера и нагрузка</h3>
          <div className="pb1a-stats" role="list">
            <StatCard
              label="Средний подъём · неделя"
              value={data.stats.wakeAvgWeek || "—"}
              hint="онлайн > 50 после 08:00 МСК"
            />
            <StatCard
              label="Средний подъём · месяц"
              value={data.stats.wakeAvgMonth || "—"}
              hint="SEED → AAS/RAAS (по всплеску онлайна)"
            />
            <StatCard
              label="Пик уникальных / час"
              value={`${data.stats.peakHourUnique} · ${pad2(data.stats.peakHour)}:00`}
            />
            <StatCard
              label="Человеко-часы периода"
              value={data.stats.playerHours}
            />
            <StatCard
              label="Средняя сессия"
              value={
                data.stats.avgSessionMin != null
                  ? `${data.stats.avgSessionMin} мин`
                  : "—"
              }
            />
            <StatCard
              label="Самый жирный / тихий час"
              value={`${pad2(data.stats.busyHour)}:00 / ${pad2(data.stats.quietHour)}:00`}
              hint={
                data.timelineMode === "average"
                  ? "по среднему профилю"
                  : "по выбранному дню"
              }
            />
            <StatCard
              label="Уникальных в выбранном периоде"
              value={data.stats.uniqueSteamIds}
              hint={data.label}
            />
          </div>
        </>
      ) : loading ? (
        <p className="muted">Считаю аналитику PB1…</p>
      ) : null}
    </section>
  );
}
