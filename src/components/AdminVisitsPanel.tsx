"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type RosterUser = {
  id: string;
  nick: string | null;
  steamName: string | null;
  steamId: string;
  visits: number;
};

type VisitRow = {
  id: string;
  path: string;
  nickAt: string | null;
  referrer?: string | null;
  createdAt: string;
};

type PathCount = { path: string; count: number };

type Summary = {
  today: string;
  todayPeople: number;
  todayVisits: number;
  periodDays: number;
  periodVisits: number;
  avgPeoplePerDay: number;
  avgVisitsPerDay: number;
  logSince: string | null;
};

type Traffic = {
  uniqueAll: number;
  uniqueToday: number;
  uniquePeriod: number;
  linkedAll: number;
  linkedPeriod: number;
  registeredAll: number;
  registeredPeriod: number;
  conversionPct: number;
  sources: { source: string; count: number }[];
  landings: { path: string; count: number }[];
  paths: { path: string; count: number }[];
  daily: {
    day: string;
    newVisitors: number;
    hits: number;
    authHits: number;
  }[];
  hourly: { hour: number; hits: number }[];
  onlineNow: {
    id: string;
    nick: string | null;
    steamName: string | null;
    steamId: string;
    lastSeenAt: string | null;
  }[];
};

function labelOf(u: {
  nick: string | null;
  steamName: string | null;
  steamId: string;
}) {
  return u.nick || u.steamName || u.steamId;
}

function todayMsk(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(d);
}

function formatDayShort(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return ymd;
  return `${String(d).padStart(2, "0")}.${String(m).padStart(2, "0")}`;
}

const SESSION_GAP_MS = 30 * 60 * 1000;

function withSessions(visits: VisitRow[]) {
  const out: { session: number; row: VisitRow }[] = [];
  let session = 0;
  let prevTs: number | null = null;
  for (const row of visits) {
    const t = Date.parse(row.createdAt);
    if (prevTs !== null && prevTs - t > SESSION_GAP_MS) session += 1;
    out.push({ session, row });
    prevTs = t;
  }
  return out;
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <div className="visits-stat">
      <div className="muted" style={{ fontSize: 12 }}>
        {label}
      </div>
      <strong style={{ fontSize: 22 }}>{value}</strong>
      {hint ? (
        <div className="muted" style={{ fontSize: 12 }}>
          {hint}
        </div>
      ) : null}
    </div>
  );
}

/** Горизонтальная шкала (не радиальная). */
function BarList({
  title,
  hint,
  rows,
  empty,
}: {
  title: string;
  hint?: string;
  rows: { label: string; value: number; sub?: string }[];
  empty?: string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="visits-chart-card">
      <h4 className="visits-chart-title">{title}</h4>
      {hint ? <p className="muted visits-chart-hint">{hint}</p> : null}
      {!rows.length ? (
        <p className="muted" style={{ margin: 0 }}>
          {empty || "Пока нет данных"}
        </p>
      ) : (
        <ul className="visits-bar-list">
          {rows.map((r) => (
            <li key={r.label} className="visits-bar-row">
              <div className="visits-bar-meta">
                <span className="visits-bar-label" title={r.label}>
                  {r.label}
                </span>
                <span className="visits-bar-value">
                  {r.value}
                  {r.sub ? (
                    <span className="muted" style={{ marginLeft: 6 }}>
                      {r.sub}
                    </span>
                  ) : null}
                </span>
              </div>
              <div className="visits-bar-track">
                <div
                  className="visits-bar-fill"
                  style={{ width: `${Math.max(2, (100 * r.value) / max)}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Вертикальные столбцы по дням / часам. */
function ColumnChart({
  title,
  hint,
  columns,
  empty,
}: {
  title: string;
  hint?: string;
  columns: { key: string; label: string; a: number; b?: number }[];
  empty?: string;
}) {
  const max = Math.max(
    1,
    ...columns.map((c) => Math.max(c.a, c.b ?? 0))
  );
  return (
    <div className="visits-chart-card visits-chart-wide">
      <h4 className="visits-chart-title">{title}</h4>
      {hint ? <p className="muted visits-chart-hint">{hint}</p> : null}
      {!columns.length ? (
        <p className="muted" style={{ margin: 0 }}>
          {empty || "Пока нет данных"}
        </p>
      ) : (
        <div className="visits-col-chart">
          {columns.map((c) => (
            <div key={c.key} className="visits-col">
              <div className="visits-col-bars">
                <div
                  className="visits-col-a"
                  style={{ height: `${Math.max(2, (100 * c.a) / max)}%` }}
                  title={`${c.label}: ${c.a}`}
                />
                {c.b != null ? (
                  <div
                    className="visits-col-b"
                    style={{ height: `${Math.max(0, (100 * c.b) / max)}%` }}
                    title={`${c.label} (свои): ${c.b}`}
                  />
                ) : null}
              </div>
              <span className="visits-col-label">{c.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function AdminVisitsPanel() {
  const [date, setDate] = useState("");
  const [periodDays, setPeriodDays] = useState(14);
  const [roster, setRoster] = useState<RosterUser[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [traffic, setTraffic] = useState<Traffic | null>(null);
  const [q, setQ] = useState("");
  const [userId, setUserId] = useState("");
  const [visits, setVisits] = useState<VisitRow[]>([]);
  const [byPath, setByPath] = useState<PathCount[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [selectedLabel, setSelectedLabel] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const loadRoster = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const params = new URLSearchParams({ periodDays: String(periodDays) });
      if (date) params.set("date", date);
      const res = await fetch(`/api/admin/visits?${params}`, {
        cache: "no-store",
      });
      const text = await res.text();
      let json: Record<string, unknown> = {};
      try {
        json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
      } catch {
        throw new Error(
          text
            ? `Ответ не JSON (${res.status}): ${text.slice(0, 120)}`
            : `Пустой ответ сервера (${res.status})`
        );
      }
      if (!res.ok) {
        const detail =
          typeof json.detail === "string" ? ` — ${json.detail}` : "";
        throw new Error(
          `${typeof json.error === "string" ? json.error : "Нет доступа"}${detail}`
        );
      }
      setRoster((json.users || []) as RosterUser[]);
      setSummary((json.summary as Summary) || null);
      setTraffic((json.traffic as Traffic) || null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Ошибка");
      setRoster([]);
      setSummary(null);
      setTraffic(null);
    } finally {
      setLoading(false);
    }
  }, [date, periodDays]);

  const loadUser = useCallback(
    async (opts?: { append?: boolean; before?: string | null }) => {
      if (!userId) {
        setVisits([]);
        setByPath([]);
        setTotal(0);
        setHasMore(false);
        setNextBefore(null);
        return;
      }
      setLoading(true);
      setErr(null);
      try {
        const params = new URLSearchParams({ userId, limit: "1000" });
        if (date) params.set("date", date);
        if (opts?.append && opts.before) params.set("before", opts.before);
        const res = await fetch(`/api/admin/visits?${params}`, {
          cache: "no-store",
        });
        const text = await res.text();
        let json: Record<string, unknown> = {};
        try {
          json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
        } catch {
          throw new Error(
            text
              ? `Ответ не JSON (${res.status}): ${text.slice(0, 120)}`
              : `Пустой ответ сервера (${res.status})`
          );
        }
        if (!res.ok) {
          const detail =
            typeof json.detail === "string" ? ` — ${json.detail}` : "";
          throw new Error(
            `${typeof json.error === "string" ? json.error : "Нет доступа"}${detail}`
          );
        }
        const next = (json.visits || []) as VisitRow[];
        setVisits((prev) => (opts?.append ? [...prev, ...next] : next));
        setByPath((json.byPath || []) as PathCount[]);
        setTotal(Number(json.total) || 0);
        setHasMore(Boolean(json.hasMore));
        setNextBefore(
          typeof json.nextBefore === "string" ? json.nextBefore : null
        );
        if (json.user) setSelectedLabel(labelOf(json.user as RosterUser));
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Ошибка");
        if (!opts?.append) {
          setVisits([]);
          setByPath([]);
          setTotal(0);
        }
      } finally {
        setLoading(false);
      }
    },
    [userId, date]
  );

  useEffect(() => {
    void loadRoster();
  }, [loadRoster]);

  useEffect(() => {
    setVisits([]);
    setNextBefore(null);
    void loadUser();
  }, [loadUser]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let list = roster;
    if (needle) {
      list = list.filter((u) => {
        const blob =
          `${u.nick || ""} ${u.steamName || ""} ${u.steamId}`.toLowerCase();
        return blob.includes(needle);
      });
    }
    return [...list].sort((a, b) => {
      if (b.visits !== a.visits) return b.visits - a.visits;
      return labelOf(a).localeCompare(labelOf(b), "ru");
    });
  }, [roster, q]);

  const sessionRows = useMemo(() => withSessions(visits), [visits]);

  const topPlayers = useMemo(
    () =>
      filtered
        .filter((u) => u.visits > 0)
        .slice(0, 15)
        .map((u) => ({
          label: labelOf(u),
          value: u.visits,
        })),
    [filtered]
  );

  return (
    <section className="card journal-card visits-panel">
      <p className="muted" style={{ marginTop: 0 }}>
        Это <strong>заходы на сайт bb-squad.ru</strong> (не логи TR1). Считаем
        гостей и залогиненных: кто открыл страницу, когда, откуда пришёл, куда
        чаще всего заходит. Только для тебя (Keech).
      </p>

      <div className="journal-toolbar" style={{ flexWrap: "wrap", gap: 12 }}>
        <label className="field" style={{ margin: 0 }}>
          <span>Дата (МСК)</span>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        <button type="button" className="btn-ghost" onClick={() => setDate("")}>
          Все дни
        </button>
        <button
          type="button"
          className="btn-ghost"
          onClick={() => setDate(todayMsk())}
        >
          Сегодня
        </button>
        <label className="field" style={{ margin: 0 }}>
          <span>Период графиков, дн.</span>
          <select
            value={periodDays}
            onChange={(e) => setPeriodDays(Number(e.target.value))}
          >
            <option value={7}>7</option>
            <option value={14}>14</option>
            <option value={30}>30</option>
            <option value={60}>60</option>
          </select>
        </label>
        <label className="field" style={{ margin: 0, flex: 1, minWidth: 160 }}>
          <span>Поиск ника</span>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="ник / steam…"
          />
        </label>
        <button
          type="button"
          className="btn-ghost"
          onClick={() => {
            void loadRoster();
            void loadUser();
          }}
          disabled={loading}
        >
          Обновить
        </button>
      </div>

      {err ? <p className="form-error">{err}</p> : null}
      {loading && !traffic && !summary ? (
        <p className="muted">Загрузка аналитики…</p>
      ) : null}

      {traffic ? (
        <>
          <h3 style={{ marginBottom: 8 }}>Сводка</h3>
          <div className="visits-stat-grid">
            <Stat
              label="Уникальных всего"
              value={traffic.uniqueAll}
              hint={`зарегались ${traffic.linkedAll} (${traffic.conversionPct}%)`}
            />
            <Stat
              label="Уникальных сегодня"
              value={traffic.uniqueToday}
              hint="гости + свои"
            />
            <Stat
              label={`Уникальных за ${periodDays} дн.`}
              value={traffic.uniquePeriod}
              hint={`новых рег.: ${traffic.registeredPeriod}`}
            />
            <Stat
              label="Сейчас на сайте"
              value={traffic.onlineNow?.length ?? 0}
              hint="heartbeat ≤3 мин"
            />
            {summary ? (
              <>
                <Stat
                  label="Свои сегодня"
                  value={summary.todayPeople}
                  hint={`${summary.todayVisits} хитов`}
                />
                <Stat
                  label="Ср. хитов / день"
                  value={summary.avgVisitsPerDay}
                  hint={`за ${summary.periodDays} дн.`}
                />
              </>
            ) : null}
          </div>

          {traffic.onlineNow?.length ? (
            <p className="visits-online-line">
              <strong>Онлайн:</strong>{" "}
              {traffic.onlineNow.map((u) => labelOf(u)).join(" · ")}
            </p>
          ) : (
            <p className="muted visits-online-line">Сейчас на сайте никого нет</p>
          )}

          <h3 style={{ marginBottom: 8 }}>Динамика · куда ходят</h3>
          <p className="muted" style={{ marginTop: 0 }}>
            Смотри всплески по дням после правок сайта. «Куда тыкают» = какие
            страницы открывают чаще всего (pageview).
          </p>

          <div className="visits-charts-grid">
            <ColumnChart
              title={`Хиты по дням (МСК) · ${periodDays} дн.`}
              hint="Светлый столбец — все хиты, тёмный — только залогиненные"
              columns={(traffic.daily || []).map((d) => ({
                key: d.day,
                label: formatDayShort(d.day),
                a: d.hits,
                b: d.authHits ?? 0,
              }))}
            />
            <ColumnChart
              title="Активность по часам (МСК)"
              hint="Сумма хитов за выбранный период по часу суток"
              columns={(traffic.hourly || []).map((h) => ({
                key: String(h.hour),
                label: `${String(h.hour).padStart(2, "0")}`,
                a: h.hits,
              }))}
            />
            <BarList
              title="Куда чаще заходят"
              hint="Топ страниц сайта за период"
              rows={(traffic.paths || []).map((p) => ({
                label: p.path,
                value: p.count,
              }))}
              empty="Ещё нет pageview — зайди на пару страниц и обнови"
            />
            <BarList
              title="Первая страница (лендинг)"
              hint="С какой страницы впервые попали"
              rows={(traffic.landings || []).map((p) => ({
                label: p.path,
                value: p.count,
              }))}
            />
            <BarList
              title="Откуда пришли"
              hint="Реферер / прямой заход"
              rows={(traffic.sources || []).map((s) => ({
                label: s.source,
                value: s.count,
              }))}
            />
            <BarList
              title="Кто из своих заходит чаще"
              hint={
                date
                  ? `Заходы за ${date} (залогиненные)`
                  : "Заходы за выбранную дату / все дни"
              }
              rows={topPlayers}
              empty="Пока нет заходов залогиненных"
            />
          </div>
        </>
      ) : null}

      <p className="muted" style={{ marginTop: 16 }}>
        Лента по игроку:{" "}
        <strong>{date ? `только ${date}` : "все дни"}</strong>
        {summary?.logSince
          ? ` · лог с ${formatWhen(summary.logSince)}`
          : " · записей ещё нет"}
        {loading ? " · загрузка…" : ""}
      </p>

      <div className="visits-split">
        <div
          className="admin-table-wrap"
          style={{ maxHeight: 520, overflow: "auto" }}
        >
          <table className="admin-table">
            <thead>
              <tr>
                <th>Ник</th>
                <th className="num">Заходы</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((u) => {
                const active = u.id === userId;
                return (
                  <tr
                    key={u.id}
                    onClick={() => setUserId(u.id)}
                    style={{
                      cursor: "pointer",
                      background: active
                        ? "rgba(255,255,255,0.08)"
                        : undefined,
                    }}
                  >
                    <td>{labelOf(u)}</td>
                    <td className="num">{u.visits}</td>
                  </tr>
                );
              })}
              {!filtered.length && !loading ? (
                <tr>
                  <td colSpan={2} className="muted">
                    Никого нет
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <div>
          {!userId ? (
            <p className="muted">
              Выбери игрока слева — полная лента: когда зашёл на сайт и какие
              страницы открывал. Сверху — общая аналитика по всем.
            </p>
          ) : (
            <>
              <h3 style={{ marginTop: 0 }}>
                {selectedLabel || "…"} · {total} заход
                {total === 1 ? "" : total > 1 && total < 5 ? "а" : "ов"}
                {date ? ` · ${date}` : " · все дни"}
                {visits.length < total ? ` · показано ${visits.length}` : ""}
              </h3>
              {byPath.length ? (
                <div style={{ marginBottom: 12 }}>
                  <BarList
                    title="Его страницы"
                    rows={byPath.slice(0, 12).map((p) => ({
                      label: p.path,
                      value: p.count,
                    }))}
                  />
                </div>
              ) : null}
              <div
                className="admin-table-wrap"
                style={{ maxHeight: 460, overflow: "auto" }}
              >
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Сессия</th>
                      <th>Когда (МСК)</th>
                      <th>Страница</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sessionRows.map(({ session, row }, i) => {
                      const prev = sessionRows[i - 1];
                      const showSep = prev && prev.session !== session;
                      return (
                        <tr
                          key={row.id}
                          style={
                            showSep
                              ? {
                                  borderTop:
                                    "1px solid rgba(255,255,255,0.15)",
                                }
                              : undefined
                          }
                        >
                          <td className="muted">#{session + 1}</td>
                          <td>{formatWhen(row.createdAt)}</td>
                          <td>
                            <code>{row.path}</code>
                          </td>
                        </tr>
                      );
                    })}
                    {!visits.length && !loading ? (
                      <tr>
                        <td colSpan={3} className="muted">
                          Пусто за выбранный фильтр
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
              {hasMore ? (
                <p style={{ marginTop: 10 }}>
                  <button
                    type="button"
                    className="btn-ghost"
                    disabled={loading}
                    onClick={() =>
                      void loadUser({ append: true, before: nextBefore })
                    }
                  >
                    Загрузить ещё
                  </button>
                </p>
              ) : null}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
