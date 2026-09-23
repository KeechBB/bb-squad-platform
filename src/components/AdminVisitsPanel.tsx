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

export function AdminVisitsPanel() {
  const [date, setDate] = useState(todayMsk);
  const [roster, setRoster] = useState<RosterUser[]>([]);
  const [q, setQ] = useState("");
  const [userId, setUserId] = useState("");
  const [visits, setVisits] = useState<VisitRow[]>([]);
  const [byPath, setByPath] = useState<PathCount[]>([]);
  const [total, setTotal] = useState(0);
  const [selectedLabel, setSelectedLabel] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const loadRoster = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const params = new URLSearchParams();
      if (date) params.set("date", date);
      const res = await fetch(`/api/admin/visits?${params}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Нет доступа");
      setRoster((json.users || []) as RosterUser[]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Ошибка");
      setRoster([]);
    } finally {
      setLoading(false);
    }
  }, [date]);

  const loadUser = useCallback(async () => {
    if (!userId) {
      setVisits([]);
      setByPath([]);
      setTotal(0);
      return;
    }
    setLoading(true);
    setErr(null);
    try {
      const params = new URLSearchParams({ userId });
      if (date) params.set("date", date);
      const res = await fetch(`/api/admin/visits?${params}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Нет доступа");
      setVisits((json.visits || []) as VisitRow[]);
      setByPath((json.byPath || []) as PathCount[]);
      setTotal(Number(json.total) || 0);
      if (json.user) setSelectedLabel(labelOf(json.user));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Ошибка");
      setVisits([]);
      setByPath([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [userId, date]);

  useEffect(() => {
    void loadRoster();
  }, [loadRoster]);

  useEffect(() => {
    void loadUser();
  }, [loadUser]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return roster;
    return roster.filter((u) => {
      const blob = `${u.nick || ""} ${u.steamName || ""} ${u.steamId}`.toLowerCase();
      return blob.includes(needle);
    });
  }, [roster, q]);

  return (
    <section className="card journal-card">
      <p className="muted" style={{ marginTop: 0 }}>
        Только для тебя (Keech). Заходы залогиненных с заполненной анкетой. Один
        путь не пишется чаще раза в 3 минуты.
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

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(200px, 280px) 1fr",
          gap: 16,
          marginTop: 12,
        }}
      >
        <div className="admin-table-wrap" style={{ maxHeight: 480, overflow: "auto" }}>
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
            <p className="muted">Выбери человека слева — покажу ленту заходов.</p>
          ) : (
            <>
              <h3 style={{ marginTop: 0 }}>
                {selectedLabel || "…"} · {total} заход
                {total === 1 ? "" : total > 1 && total < 5 ? "а" : "ов"}
                {date ? ` · ${date}` : ""}
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
              <div className="admin-table-wrap" style={{ maxHeight: 420, overflow: "auto" }}>
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Когда (МСК)</th>
                      <th>Страница</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visits.map((v) => (
                      <tr key={v.id}>
                        <td>{formatWhen(v.createdAt)}</td>
                        <td>
                          <code>{v.path}</code>
                        </td>
                      </tr>
                    ))}
                    {!visits.length && !loading ? (
                      <tr>
                        <td colSpan={2} className="muted">
                          За эту дату заходов нет
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
