"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatBirthDateInput } from "@/lib/validation";

type Props = {
  active: boolean;
  untilLabel: string | null;
  reason: string | null;
  compact?: boolean;
};

export function ReservePanel({ active, untilLabel, reason, compact = false }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [until, setUntil] = useState("");
  const [why, setWhy] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function enterReserve(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/profile/reserve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ until, reason: why }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Не удалось");
        return;
      }
      setOpen(false);
      setUntil("");
      setWhy("");
      router.refresh();
    } catch {
      setError("Сеть недоступна");
    } finally {
      setLoading(false);
    }
  }

  async function exitReserve() {
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/profile/reserve", { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Не удалось");
        return;
      }
      router.refresh();
    } catch {
      setError("Сеть недоступна");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className={`card reserve-panel${compact ? " reserve-panel-compact" : ""}`}>
      <h2>Резерв</h2>
      {active ? (
        <>
          <p className="reserve-status">
            Ты в резерве до <strong>{untilLabel}</strong>
            {reason ? (
              <>
                .<br />
                <span className="muted">Причина: {reason}</span>
              </>
            ) : null}
          </p>
          <button
            type="button"
            className="btn primary"
            disabled={loading}
            onClick={() => void exitReserve()}
          >
            {loading ? "…" : "Выйти из резерва"}
          </button>
        </>
      ) : open ? (
        <form className="form" onSubmit={enterReserve} style={{ marginTop: 6 }}>
          <label className="field">
            <span>Дата до</span>
            <input
              type="text"
              inputMode="numeric"
              placeholder="ДД.ММ.ГГГГ"
              value={until}
              onChange={(e) => setUntil(formatBirthDateInput(e.target.value))}
              maxLength={10}
              required
            />
          </label>
          <label className="field">
            <span>Причина</span>
            <textarea
              value={why}
              onChange={(e) => setWhy(e.target.value)}
              rows={compact ? 2 : 3}
              maxLength={300}
              required
              placeholder="Учёба, работа…"
            />
          </label>
          {error ? <p className="error">{error}</p> : null}
          <div className="avatar-actions">
            <button type="submit" className="btn primary" disabled={loading}>
              {loading ? "…" : "Ок"}
            </button>
            <button
              type="button"
              className="btn ghost"
              disabled={loading}
              onClick={() => {
                setOpen(false);
                setError("");
              }}
            >
              Отмена
            </button>
          </div>
        </form>
      ) : (
        <>
          {!compact ? (
            <p className="muted" style={{ marginTop: 4 }}>
              Если не можешь играть какое-то время — уйди в резерв с датой и причиной.
            </p>
          ) : (
            <p className="muted reserve-panel-hint">Не играешь — в резерв</p>
          )}
          <button
            type="button"
            className="btn primary"
            onClick={() => setOpen(true)}
          >
            Уйти в резерв
          </button>
        </>
      )}
      {error && active ? <p className="error">{error}</p> : null}
    </section>
  );
}
