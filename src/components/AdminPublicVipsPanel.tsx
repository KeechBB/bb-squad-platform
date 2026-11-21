"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { AdminTermRangeModal } from "@/components/AdminTermRangeModal";
import "@/app/admin/panelka/panelka.css";

type VipRow = {
  steamId: string;
  nick: string | null;
  startsAt: string | null;
  endsAt: string | null;
  forever: boolean;
  byNick: string;
  grantedAt: string | null;
  note: string | null;
  source: string;
};

function fmt(iso: string | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
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

export function AdminPublicVipsPanel() {
  const [rows, setRows] = useState<VipRow[]>([]);
  const [q, setQ] = useState("");
  const [qApplied, setQApplied] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [grantOpen, setGrantOpen] = useState(false);
  const [prefill, setPrefill] = useState({ steamId: "", nick: "" });

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) {
      setLoading(true);
      setErr(null);
    }
    try {
      const res = await fetch("/api/admin/vips", { cache: "no-store" });
      const data = (await res.json()) as { ok?: boolean; vips?: VipRow[]; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error || "не удалось загрузить VIP");
      setRows(data.vips || []);
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
      [r.nick, r.steamId, r.byNick, r.note, r.endsAt]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(needle)
    );
  }, [rows, qApplied]);

  async function revoke(steamId: string) {
    if (!window.confirm(`Снять VIP (QueuePriority) с ${steamId}?`)) return;
    setBusy(true);
    setNotice("");
    try {
      const res = await fetch("/api/admin/vips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "revoke", steamId }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; reply?: string; vips?: VipRow[] };
      if (!res.ok || !data.ok) {
        setErr(data.error || "не снялось");
        return;
      }
      if (data.vips) setRows(data.vips);
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
            placeholder="Ник или Steam ID…"
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
          onClick={() => {
            setPrefill({ steamId: "", nick: "" });
            setGrantOpen(true);
          }}
        >
          Выдать VIP
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
              <th>От</th>
              <th>До</th>
              <th>Выдал</th>
              <th>Когда</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {!loading && filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="muted">
                  Действующих VIP нет{qApplied ? ` по запросу «${qApplied}»` : ""}.
                </td>
              </tr>
            ) : null}
            {filtered.map((row) => (
              <tr key={row.steamId}>
                <td>{row.nick || "—"}</td>
                <td className="mono admin-steam-id">
                  <a
                    href={`https://steamcommunity.com/profiles/${row.steamId}`}
                    target="_blank"
                    rel="noreferrer"
                    title="Открыть Steam"
                  >
                    {row.steamId}
                  </a>
                </td>
                <td>{fmt(row.startsAt)}</td>
                <td>{row.forever ? "навсегда" : fmt(row.endsAt)}</td>
                <td>{row.byNick || "—"}</td>
                <td>{fmt(row.grantedAt)}</td>
                <td>
                  <button
                    type="button"
                    className="btn"
                    disabled={busy}
                    onClick={() => void revoke(row.steamId)}
                  >
                    Снять
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted" style={{ marginTop: 8 }}>
        Всего: {filtered.length}
        {qApplied ? ` · фильтр «${qApplied}»` : ""} · группа QueuePriority на паблике
      </p>

      {grantOpen ? (
        <AdminTermRangeModal
          title="Выдать VIP (приоритет очереди)"
          confirmLabel="Выдать"
          steamId={prefill.steamId}
          nick={prefill.nick}
          reasonLabel="Заметка"
          busy={busy}
          onClose={() => setGrantOpen(false)}
          onConfirm={(payload) => {
            void (async () => {
              setBusy(true);
              setErr(null);
              try {
                const res = await fetch("/api/admin/vips", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    action: "grant",
                    steamId: payload.steamId,
                    nick: payload.nick,
                    note: payload.reason,
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
                  vips?: VipRow[];
                  reply?: string;
                };
                if (!res.ok || !data.ok) {
                  setErr(data.error || "не выдалось");
                  return;
                }
                if (data.vips) setRows(data.vips);
                setNotice(data.reply || "выдано");
                setGrantOpen(false);
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
