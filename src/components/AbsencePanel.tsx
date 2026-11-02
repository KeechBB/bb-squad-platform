"use client";

import { useEffect, useState } from "react";
import { AbsenceFormFields } from "@/components/AbsenceFormFields";
import {
  ABSENCE_REASON_OTHER,
  resolveAbsenceReason,
  todayIsoLocal,
} from "@/lib/absenceReasons";
import { formatRuDate } from "@/lib/validation";

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
  /** @deprecated страница сама перезагружается после Ок */
  onChanged?: () => void | Promise<void>;
};

function untilLabelFromIso(iso: string): string {
  const t = String(iso || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) {
    const [y, m, d] = t.split("-").map(Number);
    return formatRuDate(new Date(Date.UTC(y, m - 1, d)));
  }
  const d = new Date(t);
  if (!Number.isNaN(d.getTime())) return formatRuDate(d);
  return t;
}

/**
 * Компактная панель выходной/резерв.
 * После успеха — alert «заявка принята» и перезагрузка страницы.
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
  const [mode, setMode] = useState<Mode>("idle");
  const [from, setFrom] = useState("");
  const [until, setUntil] = useState("");
  const [reasonPreset, setReasonPreset] = useState("Учёба");
  const [reasonCustom, setReasonCustom] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState<{
    fromLabel: string;
    untilLabel: string;
    reasonText: string;
  } | null>(null);

  useEffect(() => {
    let stop = false;
    fetch("/api/profile/reserve", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!stop && data?.pending) setPending(data.pending);
      })
      .catch(() => {});
    return () => {
      stop = true;
    };
  }, []);

  const active = reserveActive || dayOffActive;
  const openForm = mode !== "idle" && !active;

  function resetForm() {
    setFrom("");
    setUntil("");
    setReasonPreset("Учёба");
    setReasonCustom("");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (mode === "idle" || loading) return;
    setError("");
    const reason = resolveAbsenceReason(reasonPreset, reasonCustom);
    if (reasonPreset === ABSENCE_REASON_OTHER && reason.length < 3) {
      setError("Напиши причину (от 3 символов)");
      return;
    }
    if (!until || (mode === "reserve" && !from)) {
      setError("Укажи даты");
      return;
    }
    setLoading(true);
    try {
      const url =
        mode === "dayoff" ? "/api/profile/day-off" : "/api/profile/reserve";
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          mode === "reserve"
            ? {
                from,
                until,
                reasonKey: reasonPreset,
                reasonText: reason,
              }
            : { until, reason }
        ),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Не удалось");
        setLoading(false);
        return;
      }
      const untilRu = untilLabelFromIso(
        data?.dayOff?.dayOffUntil || data?.reserve?.reserveUntil || until
      );
      const msg =
        mode === "dayoff"
          ? `Заявка принята. Отдыхай до ${untilRu}.`
          : "Заявка отправлена. HR решит её в разделе «Резерв».";
      window.alert(msg);
      window.location.reload();
    } catch {
      setError("Сеть недоступна");
      setLoading(false);
    }
  }

  async function exitCurrent() {
    if (loading) return;
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
        setLoading(false);
        return;
      }
      window.alert(
        reserveActive ? "Ок, ты вышел из резерва." : "Ок, выходной снят."
      );
      window.location.reload();
    } catch {
      setError("Сеть недоступна");
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
                : "Резерв: от 4 дней. Заявку смотрит HR."}
            </p>
            <AbsenceFormFields
              from={mode === "reserve" ? from : undefined}
              onFrom={mode === "reserve" ? setFrom : undefined}
              until={until}
              onUntil={setUntil}
              reasonPreset={reasonPreset}
              onReasonPreset={setReasonPreset}
              reasonCustom={reasonCustom}
              onReasonCustom={setReasonCustom}
              compact
            />
            {error ? <p className="error">{error}</p> : null}
            <div className="avatar-actions">
              <button type="submit" className="btn primary" disabled={loading}>
                {loading
                  ? "…"
                  : mode === "reserve"
                    ? "Отправить заявку"
                    : "Ок"}
              </button>
              <button
                type="button"
                className="btn ghost"
                disabled={loading}
                onClick={() => {
                  setMode("idle");
                  setError("");
                  resetForm();
                }}
              >
                Отмена
              </button>
            </div>
          </form>
        </div>
      ) : (
        <div className="absence-panel-btns">
          {pending ? (
            <p className="reserve-status">
              Заявка на резерв: <strong>{pending.fromLabel}</strong> —{" "}
              <strong>{pending.untilLabel}</strong>
              <br />
              <span className="muted">{pending.reasonText}. Ждёт решения HR.</span>
            </p>
          ) : null}
          <button
            type="button"
            className="btn absence-btn-dayoff"
            disabled={loading}
            onClick={() => setMode("dayoff")}
            title="Выходной 1–3 дня"
          >
            Взять выходной
          </button>
          {pending ? null : (
            <button
              type="button"
              className="btn absence-btn-reserve"
              disabled={loading}
              onClick={() => {
                setFrom(todayIsoLocal());
                setMode("reserve");
              }}
              title="Резерв от 4 дней"
            >
              Уйти в резерв
            </button>
          )}
        </div>
      )}
      {error && active ? <p className="error">{error}</p> : null}
    </section>
  );
}
