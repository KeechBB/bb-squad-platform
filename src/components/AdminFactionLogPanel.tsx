"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

type FactionOpt = { id: string; name: string; slug: string; clanId: string };

type Entry = {
  id: string;
  createdAt: string;
  action: string;
  kind: "join" | "kick";
  message: string;
  targetNick: string | null;
  actorNick: string | null;
  faction: string | null;
  reason: string | null;
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
  }).format(d);
}

export function AdminFactionLogPanel() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [factions, setFactions] = useState<FactionOpt[]>([]);
  const [q, setQ] = useState("");
  const [qApplied, setQApplied] = useState("");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [nick, setNick] = useState("");
  const [factionSlug, setFactionSlug] = useState("");
  const [action, setAction] = useState<"join" | "kick">("join");
  const [reason, setReason] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const params = new URLSearchParams();
      if (qApplied) params.set("q", qApplied);
      const res = await fetch(`/api/admin/faction-log?${params}`, {
        cache: "no-store",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Ошибка загрузки");
      setEntries(Array.isArray(json.entries) ? json.entries : []);
      const nextFactions = Array.isArray(json.factions) ? json.factions : [];
      setFactions(nextFactions);
      setFactionSlug((prev) => prev || nextFactions[0]?.slug || "");
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
      const res = await fetch("/api/admin/faction-log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nick: nick.trim(),
          factionSlug,
          action,
          reason: reason.trim() || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Не удалось сохранить");
      setNick("");
      setReason("");
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
          <h2 className="admin-updates-title">Лог фракций</h2>
          <p className="muted admin-updates-lead">
            Вступления и исключения. При исключении командиром/замом обязательна
            причина — она видна в таблице. Поиск по нику, фракции и причине.
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
          <span>Фракция</span>
          <select
            value={factionSlug}
            onChange={(e) => setFactionSlug(e.target.value)}
            required
          >
            {!factions.length ? <option value="">Нет фракций</option> : null}
            {factions.map((f) => (
              <option key={f.id} value={f.slug}>
                {f.name}
              </option>
            ))}
          </select>
        </label>
        <label className="admin-tier-log-field">
          <span>Действие</span>
          <select
            value={action}
            onChange={(e) => setAction(e.target.value === "kick" ? "kick" : "join")}
          >
            <option value="join">Добавить</option>
            <option value="kick">Исключить</option>
          </select>
        </label>
        <label className="admin-tier-log-field admin-tier-log-field-wide">
          <span>{action === "kick" ? "Причина (обязательно)" : "Заметка"}</span>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={
              action === "kick" ? "почему исключаем" : "по желанию"
            }
            required={action === "kick"}
            autoComplete="off"
          />
        </label>
        <button type="submit" className="btn primary" disabled={busy || !factionSlug}>
          {busy ? "Сохраняю…" : action === "kick" ? "Исключить" : "Добавить"}
        </button>
      </form>

      <div className="admin-tier-log-filter">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Поиск по нику / фракции / причине"
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
        <p className="muted">Пока нет записей по фракциям.</p>
      ) : null}

      {entries.length ? (
        <div className="admin-table-wrap" style={{ marginTop: 14 }}>
          <table className="admin-table admin-tier-log-table">
            <thead>
              <tr>
                <th>Дата</th>
                <th>Игрок</th>
                <th>Событие</th>
                <th>Фракция</th>
                <th>Кто</th>
                <th>Причина</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <td className="admin-tier-log-date">{formatDate(e.createdAt)}</td>
                  <td>
                    <strong>{e.targetNick || "—"}</strong>
                  </td>
                  <td>
                    {e.kind === "kick" ? (
                      <span className="admin-tier-pill admin-tier-pill-4">исключение</span>
                    ) : (
                      <span className="admin-tier-pill admin-tier-pill-1">вступление</span>
                    )}
                  </td>
                  <td>{e.faction || "—"}</td>
                  <td className="muted">{e.actorNick || "—"}</td>
                  <td className="muted">{e.reason || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
