"use client";

import { useCallback, useEffect, useState } from "react";

type WindowState = {
  openFlag: boolean;
  isOpen: boolean;
  closedFrom: string | null;
  closedTo: string | null;
  note: string | null;
  reason: string | null;
};

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(v: string): string | null {
  if (!v.trim()) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

export function AdminTransfersPanel() {
  const [state, setState] = useState<WindowState | null>(null);
  const [openFlag, setOpenFlag] = useState(true);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setErr(null);
    const res = await fetch("/api/admin/transfers/window", { cache: "no-store" });
    const json = await res.json();
    if (!res.ok) {
      setErr(json.error || "Нет доступа");
      return;
    }
    setState(json);
    setOpenFlag(Boolean(json.openFlag));
    setFrom(toLocalInput(json.closedFrom));
    setTo(toLocalInput(json.closedTo));
    setNote(json.note || "");
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    setBusy(true);
    setMsg(null);
    setErr(null);
    try {
      const res = await fetch("/api/admin/transfers/window", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          open: openFlag,
          closedFrom: fromLocalInput(from),
          closedTo: fromLocalInput(to),
          note: note.trim() || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Ошибка");
      setState(json);
      setMsg(json.isOpen ? "Окно открыто." : "Окно закрыто.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  }

  async function runGrind() {
    setBusy(true);
    setMsg(null);
    setErr(null);
    try {
      const res = await fetch("/api/admin/transfers/grind", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: 60 }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Ошибка");
      setMsg(`Гринд: начислено записей ${json.credited} (лимит матчей ${json.limit}).`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-transfers">
      <p className="lead" style={{ marginTop: 0 }}>
        Трансферное окно фракций (Черничный Доллар). Гринд только с TR1–TR5. Закрытие — флагом или датами.
      </p>
      {state ? (
        <p className="muted">
          Сейчас:{" "}
          <strong>{state.isOpen ? "открыто" : "закрыто"}</strong>
          {state.reason ? ` — ${state.reason}` : ""}
        </p>
      ) : null}
      {msg ? <p className="ok">{msg}</p> : null}
      {err ? <p className="error">{err}</p> : null}

      <div className="admin-transfers-form">
        <label className="admin-transfers-check">
          <input
            type="checkbox"
            checked={openFlag}
            onChange={(e) => setOpenFlag(e.target.checked)}
          />
          Флаг «окно открыто»
        </label>
        <label>
          Закрыто с
          <input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          Закрыто по
          <input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <label>
          Заметка
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Сезон / турнир…" />
        </label>
        <div className="admin-transfers-actions">
          <button type="button" className="btn primary" disabled={busy} onClick={() => void save()}>
            Сохранить окно
          </button>
          <button type="button" className="btn" disabled={busy} onClick={() => void runGrind()}>
            Прогнать гринд TR1–TR5
          </button>
        </div>
      </div>
    </div>
  );
}
