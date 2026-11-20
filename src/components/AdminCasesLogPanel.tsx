"use client";

import { useCallback, useEffect, useState } from "react";

type Entry = {
  id: string;
  at: string;
  nick: string;
  caseId: string;
  caseName: string;
  currency: "BBC" | "BD";
  spent: number;
  dropKind: "patch" | "bg" | "empty" | "currency";
  dropItemId: string | null;
  dropTitle: string;
  dropImage: string | null;
  dropSell: number;
  dropSellCurrency: "BBC" | "BD" | null;
  chancePct: number;
  infiniteWallet: boolean;
  boost: boolean;
  boostKind?: string | null;
  currencyMark: string;
};

type Stats = {
  attempts: number;
  wins: number;
  empties: number;
  spentBbc: number;
  spentBd: number;
  sellBbc: number;
  sellBd: number;
};

function formatDate(iso: string): string {
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

export function AdminCasesLogPanel() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [q, setQ] = useState("");
  const [qApplied, setQApplied] = useState("");
  const [caseId, setCaseId] = useState("");
  const [drop, setDrop] = useState("");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const params = new URLSearchParams();
      if (qApplied) params.set("q", qApplied);
      if (caseId) params.set("caseId", caseId);
      if (drop) params.set("drop", drop);
      params.set("limit", "500");
      const res = await fetch(`/api/admin/cases-log?${params}`, {
        cache: "no-store",
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Ошибка загрузки");
      setEntries(Array.isArray(json.entries) ? json.entries : []);
      setStats(json.stats || null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setLoading(false);
    }
  }, [qApplied, caseId, drop]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="card admin-tier-log-panel">
      <div className="admin-updates-head">
        <div>
          <h2 className="admin-updates-title">Лог кейсов</h2>
          <p className="muted admin-updates-lead">
            Открытия кейсов Сада: кто крутил, сколько списал, что выпало и
            оценка продажи по текущей цене площадки.
          </p>
        </div>
        <button
          type="button"
          className="btn"
          onClick={() => void load()}
          disabled={loading}
        >
          Обновить
        </button>
      </div>

      {stats ? (
        <div
          className="admin-tier-log-filter"
          style={{ gap: 12, flexWrap: "wrap", marginBottom: 8 }}
        >
          <span className="muted">
            Попыток: <strong>{stats.attempts}</strong>
          </span>
          <span className="muted">
            Дроп / пусто:{" "}
            <strong>
              {stats.wins} / {stats.empties}
            </strong>
          </span>
          <span className="muted">
            Потрачено:{" "}
            <strong>
              {stats.spentBbc.toLocaleString("ru-RU")} BBC ·{" "}
              {stats.spentBd.toLocaleString("ru-RU")} $
            </strong>
          </span>
          <span className="muted">
            Дроп → продажа:{" "}
            <strong>
              {stats.sellBbc.toLocaleString("ru-RU")} BBC ·{" "}
              {stats.sellBd.toLocaleString("ru-RU")} $
            </strong>
          </span>
        </div>
      ) : null}

      <div className="admin-tier-log-filter" style={{ gap: 8, flexWrap: "wrap" }}>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Поиск по нику / кейсу / дропу"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              setQApplied(q.trim());
            }
          }}
        />
        <select
          value={caseId}
          onChange={(e) => setCaseId(e.target.value)}
          aria-label="Кейс"
        >
          <option value="">Все кейсы</option>
          <option value="faction-sad">Жатва Черники · v1</option>
          <option value="bbc-urozhay">Первый Плод · v1</option>
        </select>
        <select
          value={drop}
          onChange={(e) => setDrop(e.target.value)}
          aria-label="Результат"
        >
          <option value="">Все результаты</option>
          <option value="win">Только дроп</option>
          <option value="empty">Только пусто</option>
        </select>
        <button
          type="button"
          className="btn"
          onClick={() => setQApplied(q.trim())}
          disabled={loading}
        >
          Найти
        </button>
      </div>

      {err ? <p className="error">{err}</p> : null}
      {loading && !entries.length ? <p className="muted">Загрузка…</p> : null}
      {!loading && !entries.length && !err ? (
        <p className="muted">Пока нет открытий кейсов.</p>
      ) : null}

      {entries.length ? (
        <div className="admin-table-wrap" style={{ marginTop: 14 }}>
          <table className="admin-table admin-tier-log-table">
            <thead>
              <tr>
                <th>Время</th>
                <th>Ник</th>
                <th>Кейс</th>
                <th>Списано</th>
                <th>Результат</th>
                <th>Продажа ≈</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <td className="admin-tier-log-date">{formatDate(e.at)}</td>
                  <td>
                    <strong>{e.nick}</strong>
                    {e.infiniteWallet ? (
                      <div className="muted" style={{ fontSize: "0.85em" }}>
                        ∞ кошелёк
                      </div>
                    ) : null}
                  </td>
                  <td>
                    <strong>{e.caseName}</strong>
                    <div className="muted" style={{ fontSize: "0.85em" }}>
                      {e.caseId}
                    </div>
                  </td>
                  <td className="mono">
                    −{e.spent.toLocaleString("ru-RU")} {e.currencyMark}
                    {e.boost ? (
                      <div className="muted" style={{ fontSize: "0.85em" }}>
                        {e.boostKind === "rare"
                          ? "буст Rare +7% · джекпот +3%"
                          : e.boostKind === "drop"
                            ? "буст дропа +15%"
                            : "буст Immortal +5%"}
                      </div>
                    ) : null}
                  </td>
                  <td>
                    {e.dropKind === "empty" ? (
                      <span className="admin-tier-pill admin-tier-pill-4">
                        пусто
                      </span>
                    ) : (
                      <>
                        <strong>{e.dropTitle}</strong>
                        <div className="muted" style={{ fontSize: "0.85em" }}>
                          {e.dropKind === "bg"
                            ? "фон"
                            : e.dropKind === "currency"
                              ? "валюта"
                              : "нашивка"}
                          {e.dropItemId ? ` · ${e.dropItemId}` : ""}
                          {e.chancePct
                            ? ` · ${e.chancePct.toLocaleString("ru-RU")}%`
                            : ""}
                        </div>
                      </>
                    )}
                  </td>
                  <td className="mono">
                    {e.dropKind === "empty" || !e.dropSell ? (
                      <span className="muted">—</span>
                    ) : (
                      <strong>
                        {e.dropSell.toLocaleString("ru-RU")}{" "}
                        {e.dropSellCurrency === "BD" ? "B$" : "BBC"}
                      </strong>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
