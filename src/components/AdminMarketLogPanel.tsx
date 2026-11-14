"use client";

import { useCallback, useEffect, useState } from "react";

type Entry = {
  id: string;
  at: string;
  nick: string;
  steamId: string;
  side: "buy" | "sell";
  catalog: "нашивка" | "фон" | "шрифт";
  itemId: string;
  itemTitle: string;
  priceBbc: number;
  balanceAfter: number;
  deal: string | null;
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

export function AdminMarketLogPanel() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [q, setQ] = useState("");
  const [qApplied, setQApplied] = useState("");
  const [side, setSide] = useState("");
  const [catalog, setCatalog] = useState("");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const params = new URLSearchParams();
      if (qApplied) params.set("q", qApplied);
      if (side) params.set("side", side);
      if (catalog) params.set("catalog", catalog);
      params.set("limit", "500");
      const res = await fetch(`/api/admin/market-log?${params}`, {
        cache: "no-store",
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Ошибка загрузки");
      setEntries(Array.isArray(json.entries) ? json.entries : []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setLoading(false);
    }
  }, [qApplied, side, catalog]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="card admin-tier-log-panel">
      <div className="admin-updates-head">
        <div>
          <h2 className="admin-updates-title">Лог магазина</h2>
          <p className="muted admin-updates-lead">
            Все покупки и продажи на торговой площадке: время (МСК), ник, предмет
            и цена в BBC.
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

      <div className="admin-tier-log-filter" style={{ gap: 8, flexWrap: "wrap" }}>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Поиск по нику / предмету"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              setQApplied(q.trim());
            }
          }}
        />
        <select
          value={side}
          onChange={(e) => setSide(e.target.value)}
          aria-label="Покупка или продажа"
        >
          <option value="">Все сделки</option>
          <option value="buy">Покупки</option>
          <option value="sell">Продажи</option>
        </select>
        <select
          value={catalog}
          onChange={(e) => setCatalog(e.target.value)}
          aria-label="Каталог"
        >
          <option value="">Все каталоги</option>
          <option value="patch">Нашивки</option>
          <option value="bg">Фоны</option>
          <option value="font">Шрифты</option>
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
        <p className="muted">Пока нет сделок в магазине.</p>
      ) : null}

      {entries.length ? (
        <div className="admin-table-wrap" style={{ marginTop: 14 }}>
          <table className="admin-table admin-tier-log-table">
            <thead>
              <tr>
                <th>Время</th>
                <th>Ник</th>
                <th>Сделка</th>
                <th>Каталог</th>
                <th>Предмет</th>
                <th>Цена</th>
                <th>Баланс после</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <td className="admin-tier-log-date">{formatDate(e.at)}</td>
                  <td>
                    <strong>{e.nick}</strong>
                  </td>
                  <td>
                    {e.side === "buy" ? (
                      <span className="admin-tier-pill admin-tier-pill-4">
                        покупка
                      </span>
                    ) : (
                      <span className="admin-tier-pill admin-tier-pill-1">
                        продажа
                      </span>
                    )}
                    {e.deal ? (
                      <span className="muted" style={{ marginLeft: 8 }}>
                        {e.deal}
                      </span>
                    ) : null}
                  </td>
                  <td>{e.catalog}</td>
                  <td>
                    <strong>{e.itemTitle}</strong>
                    <div className="muted" style={{ fontSize: "0.85em" }}>
                      {e.itemId}
                    </div>
                  </td>
                  <td className="mono">
                    <strong>
                      {e.side === "buy" ? "−" : "+"}
                      {e.priceBbc.toLocaleString("ru-RU")} BBC
                    </strong>
                  </td>
                  <td className="mono muted">
                    {e.balanceAfter.toLocaleString("ru-RU")}
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
