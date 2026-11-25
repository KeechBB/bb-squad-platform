"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Pb1Bar = {
  key: string;
  label: string;
  players: number;
  staff: number;
  queue: number;
  online: number;
};

type Scope = "day" | "week" | "month";

type Payload = {
  scope: Scope;
  key: string;
  label: string;
  range: { fromYmd: string; toYmd: string };
  bars: Pb1Bar[];
  live: {
    online: number;
    players: number;
    staff: number;
    queue: number;
    map: string;
    layer: string;
    at: string;
  } | null;
  dayChoices: string[];
  weekChoices: { key: string; label: string; fromYmd: string; toYmd: string }[];
  monthChoices: { key: string; label: string }[];
  stats: {
    uniqueSteamIdsDay: number;
    uniqueSteamIdsWeek: number;
    uniqueSteamIdsMonth: number;
    newSteamIdsDay: number;
    newSteamIdsWeek: number;
    newSteamIdsMonth: number;
    wakeAvgWeek: string | null;
    wakeAvgMonth: string | null;
    peakOnline: number;
    playerHours: number;
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

function weekdayShort(ymd: string) {
  const [y, m, d] = ymd.split("-").map(Number);
  const noon = new Date(Date.UTC(y, m - 1, d, 9, 0, 0));
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    weekday: "short",
  }).format(noon);
}

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

function ConcurrentChart({
  bars,
  scope,
}: {
  bars: Pb1Bar[];
  scope: Scope;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const max = Math.max(
    1,
    ...bars.map((b) => b.players + b.staff + b.queue)
  );
  const tip = bars.find((b) => b.key === hover) || null;

  return (
    <div className="pb1a-chart">
      <div className="pb1a-chart-legend">
        <span className="pb1a-leg pb1a-leg-player">игроки</span>
        <span className="pb1a-leg pb1a-leg-staff">админы / моды</span>
        <span className="pb1a-leg pb1a-leg-queue">очередь</span>
        <span className="pb1a-chart-mode">
          {scope === "day"
            ? "concurrent по часам МСК"
            : "средний concurrent по дням"}
        </span>
      </div>
      <div
        className={`pb1a-chart-bars pb1a-chart-bars--${scope}`}
        role="img"
        aria-label="Онлайн PB1"
        style={{ ["--cols" as string]: String(Math.max(bars.length, 1)) }}
      >
        {bars.map((b) => {
          const total = b.players + b.staff + b.queue;
          const pct = (total / max) * 100;
          const stack = total > 0 ? total : 1;
          const playerPct = total > 0 ? (b.players / stack) * 100 : 0;
          const staffPct = total > 0 ? (b.staff / stack) * 100 : 0;
          const queuePct = total > 0 ? (b.queue / stack) * 100 : 0;
          const active = hover === b.key;
          return (
            <button
              key={b.key}
              type="button"
              className={`pb1a-bar${active ? " is-hover" : ""}${total > 0 ? "" : " is-empty"}`}
              style={{
                ["--bar-h" as string]: `${Math.max(pct, total > 0 ? 4 : 0)}%`,
              }}
              onMouseEnter={() => setHover(b.key)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(b.key)}
              onBlur={() => setHover(null)}
              title={`${b.label}: онлайн ${Math.round(b.online)}, игроки ${b.players}, staff ${b.staff}, очередь ${b.queue}`}
            >
              <span className="pb1a-bar-num">
                {total > 0 ? Math.round(b.online) : ""}
              </span>
              <span className="pb1a-bar-stack">
                <span
                  className="pb1a-bar-queue"
                  style={{ height: `${queuePct}%` }}
                />
                <span
                  className="pb1a-bar-staff"
                  style={{ height: `${staffPct}%` }}
                />
                <span
                  className="pb1a-bar-player"
                  style={{ height: `${playerPct}%` }}
                />
              </span>
              <span className="pb1a-bar-label">{b.label}</span>
            </button>
          );
        })}
      </div>
      {tip ? (
        <div className="pb1a-chart-tip">
          <strong>{tip.label}</strong>
          {" · онлайн "}
          {Math.round(tip.online * 10) / 10}
          {" · игроки "}
          {Math.round(tip.players * 10) / 10}
          {" · админы/моды "}
          {Math.round(tip.staff * 10) / 10}
          {" · очередь "}
          {Math.round(tip.queue * 10) / 10}
        </div>
      ) : (
        <div className="pb1a-chart-tip muted">
          Наведи на столбец — подсветка и разбивка
        </div>
      )}
    </div>
  );
}

function DayCalendar({
  days,
  selected,
  today,
  onPick,
}: {
  days: string[];
  selected: string;
  today: string;
  onPick: (ymd: string) => void;
}) {
  const byDay = useMemo(() => new Map(days.map((d) => [d, true])), [days]);
  const anchor = days[0] || today;
  const [y, m] = anchor.split("-").map(Number);
  const firstWd = (() => {
    const noon = new Date(Date.UTC(y, m - 1, 1, 9, 0, 0));
    const wd = new Intl.DateTimeFormat("en-US", {
      timeZone: "Europe/Moscow",
      weekday: "short",
    }).format(noon);
    const map: Record<string, number> = {
      Mon: 0,
      Tue: 1,
      Wed: 2,
      Thu: 3,
      Fri: 4,
      Sat: 5,
      Sun: 6,
    };
    return map[wd] ?? 0;
  })();
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells: (string | null)[] = [];
  for (let i = 0; i < firstWd; i++) cells.push(null);
  for (let d = 1; d <= last; d++) {
    cells.push(`${y}-${pad2(m)}-${pad2(d)}`);
  }
  while (cells.length % 7) cells.push(null);

  return (
    <div className="pb1a-cal">
      <div className="pb1a-cal-head" aria-hidden>
        {["пн", "вт", "ср", "чт", "пт", "сб", "вс"].map((w) => (
          <span key={w}>{w}</span>
        ))}
      </div>
      <div className="pb1a-cal-grid">
        {cells.map((ymd, i) => {
          if (!ymd) return <span key={`e${i}`} className="pb1a-cal-empty" />;
          const enabled = Boolean(byDay.get(ymd));
          const isOn = selected === ymd;
          const isToday = ymd === today;
          return (
            <button
              key={ymd}
              type="button"
              className={`pb1a-cal-day${isOn ? " is-on" : ""}${isToday ? " is-today" : ""}`}
              disabled={!enabled}
              onClick={() => onPick(ymd)}
              title={enabled ? `${weekdayShort(ymd)} ${ymd}` : "нет данных"}
            >
              {Number(ymd.slice(8, 10))}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function AdminPb1AnalyticsPanel() {
  const today = useMemo(() => mskTodayYmd(), []);
  const [scope, setScope] = useState<Scope>("day");
  const [dayKey, setDayKey] = useState(today);
  const [weekKey, setWeekKey] = useState("");
  const [monthKey, setMonthKey] = useState(today.slice(0, 7));
  const [yearKey, setYearKey] = useState(today.slice(0, 4));
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const requestKey = useMemo(() => {
    if (scope === "month") return monthKey;
    if (scope === "week") return weekKey || today;
    return dayKey;
  }, [scope, dayKey, weekKey, monthKey, today]);

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
      if (json.scope === "week" && json.key) setWeekKey(json.key);
      if (json.weekChoices?.length && !weekKey) {
        const cur = json.weekChoices.find(
          (w) => w.fromYmd <= today && w.toYmd >= today
        );
        if (cur && scope === "week") setWeekKey(cur.key);
      }
    } catch {
      setError("Сеть недоступна");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [scope, requestKey, weekKey, today]);

  useEffect(() => {
    void load();
  }, [load]);

  const years = useMemo(() => {
    const y = Number(today.slice(0, 4));
    return [y, y - 1];
  }, [today]);

  const weekChoices = data?.weekChoices || [];
  const monthChoices = data?.monthChoices || [];
  const dayChoices = data?.dayChoices || [];

  return (
    <section className="pb1a">
      <header className="pb1a-head">
        <div>
          <h2 className="pb1a-title">Аналитика PB1</h2>
          <p className="muted pb1a-sub">
            Concurrent на сервере (не уникальные за час). Админы/моды сайта —
            красным, очередь — жёлтым.
          </p>
        </div>
        <button
          type="button"
          className="btn"
          disabled={loading}
          onClick={() => void load()}
        >
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
      </div>

      {scope === "day" ? (
        <DayCalendar
          days={dayChoices.length ? dayChoices : [today]}
          selected={dayKey}
          today={today}
          onPick={setDayKey}
        />
      ) : null}

      {scope === "week" ? (
        <div className="pb1a-week-presets" role="group" aria-label="Недели месяца">
          {weekChoices.map((w) => (
            <button
              key={w.key}
              type="button"
              className={`pb1a-chip${(weekKey || data?.key) === w.key ? " is-on" : ""}`}
              onClick={() => setWeekKey(w.key)}
              title={`${w.fromYmd} → ${w.toYmd}`}
            >
              {w.label}
            </button>
          ))}
          {!weekChoices.length && loading ? (
            <span className="muted">Загружаю недели…</span>
          ) : null}
        </div>
      ) : null}

      {scope === "month" ? (
        <div className="pb1a-month-picker">
          <label className="pb1a-field pb1a-year-field">
            <span>Год</span>
            <select
              value={yearKey}
              onChange={(e) => {
                const y = e.target.value;
                setYearKey(y);
                const next = `${y}-${monthKey.slice(5, 7)}`;
                const capped =
                  next > today.slice(0, 7) ? today.slice(0, 7) : next;
                setMonthKey(capped);
              }}
            >
              {years.map((y) => (
                <option key={y} value={String(y)}>
                  {y}
                </option>
              ))}
            </select>
          </label>
          <div className="pb1a-month-chips">
            {(monthChoices.length
              ? monthChoices
              : Array.from({ length: Number(today.slice(5, 7)) }, (_, i) => ({
                  key: `${yearKey}-${pad2(i + 1)}`,
                  label: String(i + 1),
                }))
            ).map((m) => (
              <button
                key={m.key}
                type="button"
                className={`pb1a-chip${monthKey === m.key ? " is-on" : ""}`}
                disabled={m.key > today.slice(0, 7)}
                onClick={() => {
                  setYearKey(m.key.slice(0, 4));
                  setMonthKey(m.key);
                }}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {error ? <p className="error">{error}</p> : null}

      {data ? (
        <>
          {data.live ? (
            <div className="pb1a-live" aria-live="polite">
              <div className="pb1a-live-main">
                <span className="pb1a-live-dot" aria-hidden />
                <strong>Сейчас на PB1</strong>
                <span className="pb1a-live-map muted">
                  {data.live.map || "—"}
                  {data.live.layer ? ` · ${data.live.layer}` : ""}
                </span>
              </div>
              <div className="pb1a-live-nums">
                <div className="pb1a-live-card">
                  <span>Онлайн</span>
                  <strong>{data.live.online}</strong>
                </div>
                <div className="pb1a-live-card">
                  <span>Игроки</span>
                  <strong>{data.live.players}</strong>
                </div>
                <div className="pb1a-live-card is-staff">
                  <span>Админы / моды</span>
                  <strong>{data.live.staff}</strong>
                </div>
                <div className="pb1a-live-card is-queue">
                  <span>Очередь</span>
                  <strong>{data.live.queue}</strong>
                </div>
              </div>
            </div>
          ) : null}

          <div className="pb1a-period-line">
            <strong>{data.label}</strong>
            <span className="muted">
              {" "}
              · {data.range.fromYmd} → {data.range.toYmd}
            </span>
          </div>

          <ConcurrentChart bars={data.bars} scope={data.scope} />

          <h3 className="pb1a-block-title">Уникальные и новые Steam ID</h3>
          <div className="pb1a-stats" role="list">
            <StatCard
              label="Уникальных за день"
              value={data.stats.uniqueSteamIdsDay}
              hint="календарный день"
            />
            <StatCard
              label="Уникальных за неделю"
              value={data.stats.uniqueSteamIdsWeek}
              hint="пн–вс МСК"
            />
            <StatCard
              label="Уникальных за месяц"
              value={data.stats.uniqueSteamIdsMonth}
            />
            <StatCard label="Новых за день" value={data.stats.newSteamIdsDay} />
            <StatCard
              label="Новых за неделю"
              value={data.stats.newSteamIdsWeek}
            />
            <StatCard
              label="Новых за месяц"
              value={data.stats.newSteamIdsMonth}
            />
          </div>

          <h3 className="pb1a-block-title">Подъём и нагрузка</h3>
          <div className="pb1a-stats" role="list">
            <StatCard
              label="Средний подъём · неделя"
              value={data.stats.wakeAvgWeek || "—"}
              hint="онлайн > 50 после 08:00 МСК"
            />
            <StatCard
              label="Средний подъём · месяц"
              value={data.stats.wakeAvgMonth || "—"}
            />
            <StatCard
              label="Пик concurrent"
              value={data.stats.peakOnline}
              hint="максимум одновременно"
            />
            <StatCard
              label="Человеко-часы периода"
              value={data.stats.playerHours}
            />
          </div>
        </>
      ) : loading ? (
        <p className="muted">Считаю аналитику PB1…</p>
      ) : null}
    </section>
  );
}
