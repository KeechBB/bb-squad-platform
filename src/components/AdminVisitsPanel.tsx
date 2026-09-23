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

function labelOf(u: { nick: string | null; steamName: string | null; steamId: string }) {
  return u.nick || u.steamName || u.steamId;
}

function todayMsk(): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(new Date());
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

/** Разрыв > 30 мин = новая сессия */
const SESSION_GAP_MS = 30 * 60 * 1000;

function withSessions(visits: VisitRow[]) {
  // visits desc → группируем
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

export function AdminVisitsPanel() {
  const [date, setDate] = useState("");
  const [periodDays, setPeriodDays] = useState(7);
  const [roster, setRoster] = useState<RosterUser[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
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
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Ошибка");
      setRoster([]);
      setSummary(null);
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
        const params = new URLSearchParams({
          userId,
          limit: "1000",
        });
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
        Только для тебя (Keech). Логируется почти каждый заход/возврат на
        вкладку (~150 байт на запись — миллионы строк ещё норм для Neon Free).
        Кликни ника — полная лента с датой и временем. Сессии режутся, если
        пауза &gt; 30 мин.
      </p>

      {summary ? (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
            gap: 10,
            marginBottom: 14,
          }}
        >
          <div className="card" style={{ margin: 0, padding: "10px 12px" }}>
            <div className="muted" style={{ fontSize: 12 }}>
              Сегодня людей
            </div>
            <strong style={{ fontSize: 22 }}>{summary.todayPeople}</strong>
            <div className="muted" style={{ fontSize: 12 }}>
              {summary.todayVisits} заходов · {summary.today}
            </div>
          </div>
          <div className="card" style={{ margin: 0, padding: "10px 12px" }}>
            <div className="muted" style={{ fontSize: 12 }}>
              Среднее людей / день
            </div>
            <strong style={{ fontSize: 22 }}>{summary.avgPeoplePerDay}</strong>
            <div className="muted" style={{ fontSize: 12 }}>
              за {summary.periodDays} дн.
            </div>
          </div>
          <div className="card" style={{ margin: 0, padding: "10px 12px" }}>
            <div className="muted" style={{ fontSize: 12 }}>
              Среднее заходов / день
            </div>
            <strong style={{ fontSize: 22 }}>{summary.avgVisitsPerDay}</strong>
            <div className="muted" style={{ fontSize: 12 }}>
              всего {summary.periodVisits} за период
            </div>
          </div>
        </div>
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
          <span>Среднее за, дн.</span>
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
        Фильтр списка:{" "}
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
              Выбери человека — полная лента: дата, время (МСК), страница. Хоть
              500 заходов за день — все покажутся (кнопка «Ещё»).
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
                  По страницам (в загруженном куске):{" "}
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
                          {date
                            ? "За эту дату пусто — «Все дни» или «Сегодня»"
                            : "Пока нет записей после включения лога"}
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
                    onClick={() => void loadUser({ append: true, before: nextBefore })}
                  >
                    Загрузить ещё (до 1000)
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
