"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatBirthDateInput } from "@/lib/validation";

type Mode = "idle" | "dayoff" | "reserve";

type Props = {
  reserveActive: boolean;
  reserveUntilLabel: string | null;
  reserveReason: string | null;
  dayOffActive: boolean;
  dayOffUntilLabel: string | null;
  dayOffReason: string | null;
  /** Компактный вид в календаре (без заголовка «Статус») */
  compact?: boolean;
};

/**
 * Компактная панель выходной/резерв.
 * Форма открывается оверлеем — не раздвигает геометрию профиля.
 */
export function AbsencePanel({
  reserveActive,
  reserveUntilLabel,
  reserveReason,
  dayOffActive,
  dayOffUntilLabel,
  dayOffReason,
  compact = false,
}: Props) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("idle");
  const [until, setUntil] = useState("");
  const [why, setWhy] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const active = reserveActive || dayOffActive;
  const openForm = mode !== "idle" && !active;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (mode === "idle") return;
    setError("");
    setLoading(true);
    try {
      const url =
        mode === "dayoff" ? "/api/profile/day-off" : "/api/profile/reserve";
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ until, reason: why }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Не удалось");
        return;
      }
      setMode("idle");
      setUntil("");
      setWhy("");
      router.refresh();
    } catch {
      setError("Сеть недоступна");
    } finally {
      setLoading(false);
    }
  }

  async function exitCurrent() {
    setError("");
    setLoading(true);
    try {
      const url = reserveActive
        ? "/api/profile/reserve"
        : "/api/profile/day-off";
      const res = await fetch(url, { method: "DELETE" });
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
    <section
      className={`card reserve-panel reserve-panel-compact absence-panel${
        compact ? " absence-panel-in-cal" : ""
      }${openForm ? " reserve-panel-open absence-panel-open" : ""}`}
    >
      {compact ? null : <h2>Статус</h2>}

      {reserveActive ? (
        <>
          <p className="reserve-status">
            Резерв до <strong>{reserveUntilLabel}</strong>
            {reserveReason ? (
              <>
                .<br />
                <span className="muted">{reserveReason}</span>
              </>
            ) : null}
          </p>
          <button
            type="button"
            className="btn primary"
            disabled={loading}
            onClick={() => void exitCurrent()}
          >
            {loading ? "…" : "Выйти из резерва"}
          </button>
        </>
      ) : dayOffActive ? (
        <>
          <p className="reserve-status">
            Выходной до <strong>{dayOffUntilLabel}</strong>
            {dayOffReason ? (
              <>
                .<br />
                <span className="muted">{dayOffReason}</span>
              </>
            ) : null}
          </p>
          <button
            type="button"
            className="btn primary"
            disabled={loading}
            onClick={() => void exitCurrent()}
          >
            {loading ? "…" : "Снять выходной"}
          </button>
        </>
      ) : openForm ? (
        <div className="absence-panel-popover">
          <form className="form" onSubmit={submit}>
            <p className="muted reserve-panel-hint" style={{ marginBottom: 4 }}>
              {mode === "dayoff"
                ? "Выходной: 1–3 дня"
                : "Резерв: от 4 дней"}
            </p>
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
                rows={2}
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
                  setMode("idle");
                  setError("");
                }}
              >
                Отмена
              </button>
            </div>
          </form>
        </div>
      ) : (
        <div className="absence-panel-btns">
          <button
            type="button"
            className="btn absence-btn-dayoff"
            onClick={() => setMode("dayoff")}
            title="Выходной 1–3 дня"
          >
            Взять выходной
          </button>
          <button
            type="button"
            className="btn absence-btn-reserve"
            onClick={() => setMode("reserve")}
            title="Резерв от 4 дней"
          >
            Уйти в резерв
          </button>
        </div>
      )}
      {error && active ? <p className="error">{error}</p> : null}
    </section>
  );
}
