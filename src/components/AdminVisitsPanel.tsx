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
  daily: { day: string; newVisitors: number; hits: number }[];
};

function labelOf(u: { nick: string | null; steamName: string | null; steamId: string }) {
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
    <div className="card" style={{ margin: 0, padding: "10px 12px" }}>
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

export function AdminVisitsPanel() {
  const [date, setDate] = useState("");
  const [periodDays, setPeriodDays] = useState(7);
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
      const res = await fetch(`/api/admin/visits?${params}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Нет доступа");
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
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Нет доступа");
        const next = (json.visits || []) as VisitRow[];
        setVisits((prev) => (opts?.append ? [...prev, ...next] : next));
        setByPath((json.byPath || []) as PathCount[]);
        setTotal(Number(json.total) || 0);
        setHasMore(Boolean(json.hasMore));
        setNextBefore(json.nextBefore || null);
        if (json.user) setSelectedLabel(labelOf(json.user));
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
        const blob = `${u.nick || ""} ${u.steamName || ""} ${u.steamId}`.toLowerCase();
        return blob.includes(needle);
      });
    }
    return [...list].sort((a, b) => {
      if (b.visits !== a.visits) return b.visits - a.visits;
      return labelOf(a).localeCompare(labelOf(b), "ru");
    });
  }, [roster, q]);

  const sessionRows = useMemo(() => withSessions(visits), [visits]);

  return (
    <section className="card journal-card">
      <p className="muted" style={{ marginTop: 0 }}>
        Только для тебя (Keech). Считаем <strong>всех</strong> посетителей
        (гости + залогиненные): уникальные, регистрации, откуда пришли, страницы.
        Полная лента по нику — ниже.
      </p>

      {traffic ? (
        <>
          <h3 style={{ marginBottom: 8 }}>Трафик · уникальные</h3>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
              gap: 10,
              marginBottom: 14,
            }}
          >
            <Stat
              label="Уникальных всего"
              value={traffic.uniqueAll}
              hint={`из них зарегались ${traffic.linkedAll} (${traffic.conversionPct}%)`}
            />
            <Stat
              label="Уникальных сегодня"
              value={traffic.uniqueToday}
              hint="гости + свои"
            />
            <Stat
              label={`Уникальных за ${periodDays} дн.`}
              value={traffic.uniquePeriod}
              hint={`новых рег. за период: ${traffic.registeredPeriod}`}
            />
            <Stat
              label="Зарегано на сайте"
              value={traffic.registeredAll}
              hint="анкета заполнена"
            />
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: 12,
              marginBottom: 16,
            }}
          >
            <div className="admin-table-wrap" style={{ maxHeight: 220, overflow: "auto" }}>
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Откуда (реферер)</th>
                    <th className="num">чел.</th>
                  </tr>
                </thead>
                <tbody>
                  {traffic.sources.map((s) => (
                    <tr key={s.source}>
                      <td>{s.source}</td>
                      <td className="num">{s.count}</td>
                    </tr>
                  ))}
                  {!traffic.sources.length ? (
                    <tr>
                      <td colSpan={2} className="muted">
                        Пока нет внешних переходов
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            <div className="admin-table-wrap" style={{ maxHeight: 220, overflow: "auto" }}>
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Первая страница</th>
                    <th className="num">чел.</th>
                  </tr>
                </thead>
                <tbody>
                  {traffic.landings.map((s) => (
                    <tr key={s.path}>
                      <td>
                        <code>{s.path}</code>
                      </td>
                      <td className="num">{s.count}</td>
                    </tr>
                  ))}
                  {!traffic.landings.length ? (
                    <tr>
                      <td colSpan={2} className="muted">
                        —
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            <div className="admin-table-wrap" style={{ maxHeight: 220, overflow: "auto" }}>
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Топ страниц (период)</th>
                    <th className="num">хиты</th>
                  </tr>
                </thead>
                <tbody>
                  {traffic.paths.map((s) => (
                    <tr key={s.path}>
                      <td>
                        <code>{s.path}</code>
                      </td>
                      <td className="num">{s.count}</td>
                    </tr>
                  ))}
                  {!traffic.paths.length ? (
                    <tr>
                      <td colSpan={2} className="muted">
                        —
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>

          {traffic.daily.length ? (
            <div className="admin-table-wrap" style={{ maxHeight: 180, overflow: "auto", marginBottom: 16 }}>
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>День (МСК)</th>
                    <th className="num">Новых уник.</th>
                    <th className="num">Хиты</th>
                  </tr>
                </thead>
                <tbody>
                  {traffic.daily.map((d) => (
                    <tr key={d.day}>
                      <td>{d.day}</td>
                      <td className="num">{d.newVisitors}</td>
                      <td className="num">{d.hits}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </>
      ) : null}

      {summary ? (
        <>
          <h3 style={{ marginBottom: 8 }}>Залогиненные · заходы</h3>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
              gap: 10,
              marginBottom: 14,
            }}
          >
            <Stat
              label="Сегодня своих онлайн-заходов"
              value={summary.todayPeople}
              hint={`${summary.todayVisits} хитов · ${summary.today}`}
            />
            <Stat
              label="Среднее своих / день"
              value={summary.avgPeoplePerDay}
              hint={`за ${summary.periodDays} дн.`}
            />
            <Stat
              label="Среднее хитов / день"
              value={summary.avgVisitsPerDay}
              hint={`всего ${summary.periodVisits}`}
            />
          </div>
        </>
      ) : null}

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
          <span>Период, дн.</span>
          <select
            value={periodDays}
            onChange={(e) => setPeriodDays(Number(e.target.value))}
          >
            <option value={7}>7</option>
            <option value={14}>14</option>
            <option value={30}>30</option>
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

      <p className="muted" style={{ marginTop: 8 }}>
        Лента по игроку:{" "}
        <strong>{date ? `только ${date}` : "все дни"}</strong>
        {summary?.logSince
          ? ` · лог с ${formatWhen(summary.logSince)}`
          : " · записей ещё нет"}
        {loading ? " · загрузка…" : ""}
      </p>

      {err ? <p className="form-error">{err}</p> : null}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(200px, 280px) 1fr",
          gap: 16,
          marginTop: 12,
        }}
      >
        <div className="admin-table-wrap" style={{ maxHeight: 520, overflow: "auto" }}>
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
                      background: active ? "rgba(255,255,255,0.08)" : undefined,
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
              Выбери игрока слева — полная лента заходов с временем. Гостевой
              трафик смотри в блоках сверху (уникальные / откуда / страницы).
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
                <p className="muted" style={{ marginTop: 0 }}>
                  По страницам:{" "}
                  {byPath
                    .slice(0, 8)
                    .map((p) => `${p.path}×${p.count}`)
                    .join(" · ")}
                </p>
              ) : null}
              <div className="admin-table-wrap" style={{ maxHeight: 460, overflow: "auto" }}>
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
                              ? { borderTop: "1px solid rgba(255,255,255,0.15)" }
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
