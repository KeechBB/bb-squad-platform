"use client";

import { useState } from "react";
import { AbsenceFormFields } from "@/components/AbsenceFormFields";
import { SiteNoticeModal } from "@/components/SiteNoticeModal";
import {
  ABSENCE_REASON_OTHER,
  resolveAbsenceReason,
} from "@/lib/absenceReasons";

type Props = {
  active: boolean;
  untilLabel: string | null;
  reason: string | null;
  compact?: boolean;
};

export function ReservePanel({
  active,
  untilLabel,
  reason,
  compact = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const [until, setUntil] = useState("");
  const [reasonPreset, setReasonPreset] = useState("Учёба");
  const [reasonCustom, setReasonCustom] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  function resetForm() {
    setUntil("");
    setReasonPreset("Учёба");
    setReasonCustom("");
  }

  async function enterReserve(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const why = resolveAbsenceReason(reasonPreset, reasonCustom);
    if (reasonPreset === ABSENCE_REASON_OTHER && why.length < 3) {
      setError("Напиши причину (от 3 символов)");
      return;
    }
    if (!until) {
      setError("Укажи дату");
      return;
    }
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
        setLoading(false);
        return;
      }
      setLoading(false);
      setNotice("Заявка принята. Ты в резерве.");
    } catch {
      setError("Сеть недоступна");
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
        setLoading(false);
        return;
      }
      setLoading(false);
      setNotice("Ок, ты вышел из резерва.");
    } catch {
      setError("Сеть недоступна");
      setLoading(false);
    }
  }

  const openForm = !active && open;

  return (
    <section
      className={`card reserve-panel${compact ? " reserve-panel-compact" : ""}${
        openForm ? " reserve-panel-open" : ""
      }`}
    >
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
      ) : openForm ? (
        <form className="form" onSubmit={enterReserve} style={{ marginTop: 6 }}>
          <AbsenceFormFields
            until={until}
            onUntil={setUntil}
            reasonPreset={reasonPreset}
            onReasonPreset={setReasonPreset}
            reasonCustom={reasonCustom}
            onReasonCustom={setReasonCustom}
            compact={compact}
          />
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
                resetForm();
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
              Если не можешь играть какое-то время — уйди в резерв с датой и
              причиной.
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
      {notice ? (
        <SiteNoticeModal
          message={notice}
          onClose={() => window.location.reload()}
        />
      ) : null}
    </section>
  );
}
