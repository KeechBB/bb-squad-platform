"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { AdminTermRangeModal } from "@/components/AdminTermRangeModal";
import "@/app/admin/panelka/panelka.css";

type BanRow = {
  id: string;
  steamId: string;
  eosId: string;
  unbanIds?: string[];
  forever: boolean;
  endsAt: string | null;
  comment: string;
  nick: string | null;
  byNick: string | null;
  bannedAt: string | null;
};

function fmt(iso: string | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString("ru-RU", {
      timeZone: "Europe/Moscow",
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function AdminServerBansPanel() {
  const [rows, setRows] = useState<BanRow[]>([]);
  const [q, setQ] = useState("");
  const [qApplied, setQApplied] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [banOpen, setBanOpen] = useState(false);

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) {
      setLoading(true);
      setErr(null);
    }
    try {
      const res = await fetch("/api/admin/bans", { cache: "no-store" });
      const data = (await res.json()) as { ok?: boolean; bans?: BanRow[]; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error || "не удалось загрузить баны");
      setRows(data.bans || []);
    } catch (e) {
      if (!opts?.silent) setErr(e instanceof Error ? e.message : "ошибка");
    } finally {
      if (!opts?.silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const needle = qApplied.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((r) =>
      [r.nick, r.steamId, r.eosId, r.id, r.comment, r.byNick]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(needle)
    );
  }, [rows, qApplied]);

  async function unban(row: BanRow) {
    const label = row.nick || row.steamId || row.id;
    if (!window.confirm(`Снять бан с ${label}?`)) return;
    setBusy(true);
    setNotice("");
    try {
      const res = await fetch("/api/admin/bans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "unban",
          targetId: row.steamId || row.id,
          unbanIds: row.unbanIds?.length ? row.unbanIds : [row.id],
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        reply?: string;
        bans?: BanRow[];
      };
      if (!res.ok || !data.ok) {
        setErr(data.error || "не снялось");
        return;
      }
      if (data.bans) setRows(data.bans);
      setNotice(data.reply || "снято");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card journal-card">
      <form
        className="journal-toolbar"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          setQApplied(q.trim());
        }}
      >
        <label className="field" style={{ margin: 0, flex: 1, minWidth: 200 }}>
          <span>Поиск</span>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Ник, Steam ID, EOS, причина…"
            autoComplete="off"
          />
        </label>
        <button type="submit" className="btn" disabled={loading}>
          Найти
        </button>
        <button
          type="button"
          className="btn primary"
          disabled={busy}
          onClick={() => setBanOpen(true)}
        >
          Выдать бан
        </button>
        <button type="button" className="btn" disabled={loading} onClick={() => void load()}>
          Обновить
        </button>
      </form>

      {err ? <p style={{ color: "#fca5a5" }}>{err}</p> : null}
      {notice ? <p className="muted">{notice}</p> : null}

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Ник</th>
              <th>Steam ID</th>
              <th>Срок</th>
              <th>Причина</th>
              <th>Кто / когда</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {!loading && filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="muted">
                  Банов нет{qApplied ? ` по запросу «${qApplied}»` : ""}.
                </td>
              </tr>
            ) : null}
            {filtered.map((row) => (
              <tr key={`${row.steamId || row.id}-${row.eosId || ""}`}>
                <td>{row.nick || "—"}</td>
                <td className="mono admin-steam-id">
                  {row.steamId ? (
                    <a
                      href={`https://steamcommunity.com/profiles/${row.steamId}`}
                      target="_blank"
                      rel="noreferrer"
                      title="Открыть Steam"
                    >
                      {row.steamId}
                    </a>
                  ) : (
                    <span className="muted">нет Steam ID</span>
                  )}
                  {row.eosId ? (
                    <div className="muted" style={{ fontSize: "0.78rem" }}>
                      EOS {row.eosId}
                    </div>
                  ) : null}
                </td>
                <td>{row.forever ? "навсегда" : fmt(row.endsAt)}</td>
                <td>{row.comment || "—"}</td>
                <td>
                  {row.byNick || "—"}
                  {row.bannedAt ? (
                    <div className="muted" style={{ fontSize: "0.78rem" }}>
                      {fmt(row.bannedAt)}
                    </div>
                  ) : null}
                </td>
                <td>
                  <button
                    type="button"
                    className="btn"
                    disabled={busy}
                    onClick={() => void unban(row)}
                  >
                    Снять бан
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted" style={{ marginTop: 8 }}>
        Всего: {filtered.length}
        {qApplied ? ` · фильтр «${qApplied}»` : ""} · общий Bans.cfg всех серверов
      </p>

      {banOpen ? (
        <AdminTermRangeModal
          title="Выдать бан"
          confirmLabel="Забанить"
          steamId=""
          nick=""
          reasonLabel="Причина"
          reasonRequired
          busy={busy}
          onClose={() => setBanOpen(false)}
          onConfirm={(payload) => {
            void (async () => {
              setBusy(true);
              setErr(null);
              try {
                const res = await fetch("/api/admin/bans", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    action: "ban",
                    steamId: payload.steamId,
                    nick: payload.nick,
                    reason: payload.reason,
                    startsAt: new Date(payload.startsAt).toISOString(),
                    endsAt: payload.forever
                      ? null
                      : new Date(payload.endsAt).toISOString(),
                    forever: payload.forever,
                  }),
                });
                const data = (await res.json()) as {
                  ok?: boolean;
                  error?: string;
                  bans?: BanRow[];
                  reply?: string;
                };
                if (!res.ok || !data.ok) {
                  setErr(data.error || "бан не выдан");
                  return;
                }
                if (data.bans) setRows(data.bans);
                setNotice(data.reply || "забанено");
                setBanOpen(false);
              } finally {
                setBusy(false);
              }
            })();
          }}
        />
      ) : null}
    </section>
  );
}
