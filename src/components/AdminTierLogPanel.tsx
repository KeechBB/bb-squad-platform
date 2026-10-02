"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

type Entry = {
  id: string;
  changedAt: string;
  nick: string;
  fromTier: number;
  toTier: number;
  fromLabel: string;
  toLabel: string;
  note: string | null;
  batchKey: string | null;
  actorNick: string | null;
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(d);
}

function todayYmd(): string {
  const d = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const y = parts.find((p) => p.type === "year")?.value || "2026";
  const m = parts.find((p) => p.type === "month")?.value || "01";
  const day = parts.find((p) => p.type === "day")?.value || "01";
  return `${y}-${m}-${day}`;
}

export function AdminTierLogPanel() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [q, setQ] = useState("");
  const [qApplied, setQApplied] = useState("");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [nick, setNick] = useState("");
  const [fromTier, setFromTier] = useState("4");
  const [toTier, setToTier] = useState("3");
  const [date, setDate] = useState(todayYmd);
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const params = new URLSearchParams();
      if (qApplied) params.set("q", qApplied);
      const res = await fetch(`/api/admin/tier-log?${params}`, {
        cache: "no-store",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Ошибка загрузки");
      setEntries(Array.isArray(json.entries) ? json.entries : []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setLoading(false);
    }
  }, [qApplied]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/admin/tier-log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nick: nick.trim(),
          fromTier: Number(fromTier),
          toTier: Number(toTier),
          date,
          note: note.trim() || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Не удалось сохранить");
      setNick("");
      setNote("");
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card admin-tier-log-panel">
      <div className="admin-updates-head">
        <div>
          <h2 className="admin-updates-title">Лог тиров</h2>
          <p className="muted admin-updates-lead">
            Кто и когда переведён между тирами. Пакет 02.10.2026 уже в истории —
            новые переводы добавляй формой ниже.
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

      <form className="admin-tier-log-form" onSubmit={onSubmit}>
        <label className="admin-tier-log-field">
          <span>Ник</span>
          <input
            value={nick}
            onChange={(e) => setNick(e.target.value)}
            placeholder="AkiN"
            required
            autoComplete="off"
          />
        </label>
        <label className="admin-tier-log-field">
          <span>Из</span>
          <select
            value={fromTier}
            onChange={(e) => setFromTier(e.target.value)}
          >
            <option value="1">Тир 1</option>
            <option value="2">Тир 2</option>
            <option value="3">Тир 3</option>
            <option value="4">Тир 4 / вне</option>
          </select>
        </label>
        <label className="admin-tier-log-field">
          <span>В</span>
          <select value={toTier} onChange={(e) => setToTier(e.target.value)}>
            <option value="1">Тир 1</option>
            <option value="2">Тир 2</option>
            <option value="3">Тир 3</option>
            <option value="4">Тир 4 / вне</option>
          </select>
        </label>
        <label className="admin-tier-log-field">
          <span>Дата</span>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
          />
        </label>
        <label className="admin-tier-log-field admin-tier-log-field-wide">
          <span>Заметка</span>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="по желанию"
            autoComplete="off"
          />
        </label>
        <button type="submit" className="btn primary" disabled={busy}>
          {busy ? "Сохраняю…" : "Записать перевод"}
        </button>
      </form>

      <div className="admin-tier-log-filter">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Поиск по нику / заметке"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              setQApplied(q.trim());
            }
          }}
        />
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
        <p className="muted">Пока нет записей о сменах тиров.</p>
      ) : null}

      {entries.length ? (
        <div className="admin-table-wrap" style={{ marginTop: 14 }}>
          <table className="admin-table admin-tier-log-table">
            <thead>
              <tr>
                <th>Дата</th>
                <th>Игрок</th>
                <th>Перевод</th>
                <th>Кто</th>
                <th>Заметка</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <td className="admin-tier-log-date">
                    {formatDate(e.changedAt)}
                  </td>
                  <td>
                    <strong>{e.nick}</strong>
                  </td>
                  <td>
                    <span
                      className={`admin-tier-pill admin-tier-pill-${e.fromTier}`}
                    >
                      T{e.fromTier === 4 ? "4+" : e.fromTier}
                    </span>
                    <span className="admin-tier-arrow">→</span>
                    <span
                      className={`admin-tier-pill admin-tier-pill-${e.toTier}`}
                    >
                      T{e.toTier === 4 ? "4+" : e.toTier}
                    </span>
                  </td>
                  <td className="muted">{e.actorNick || "—"}</td>
                  <td className="muted">{e.note || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
