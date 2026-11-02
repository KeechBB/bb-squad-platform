"use client";

import {
  ABSENCE_REASON_OTHER,
  ABSENCE_REASON_PRESETS,
  todayIsoLocal,
} from "@/lib/absenceReasons";

type Props = {
  until: string;
  onUntil: (iso: string) => void;
  reasonPreset: string;
  onReasonPreset: (v: string) => void;
  reasonCustom: string;
  onReasonCustom: (v: string) => void;
  /** Короче textarea в компактном поповере */
  compact?: boolean;
  /** Резерв: дата начала. Выходной её не спрашивает. */
  from?: string;
  onFrom?: (iso: string) => void;
};

/** Дата (type=date) + причины кнопками; «Другое» — своё поле. */
export function AbsenceFormFields({
  until,
  onUntil,
  reasonPreset,
  onReasonPreset,
  reasonCustom,
  onReasonCustom,
  compact = false,
  from,
  onFrom,
}: Props) {
  const isOther = reasonPreset === ABSENCE_REASON_OTHER;
  const minUntil = from && from > todayIsoLocal() ? from : todayIsoLocal();
  return (
    <>
      {onFrom ? (
        <label className="field">
          <span>Дата от</span>
          <input
            type="date"
            value={from || ""}
            min={todayIsoLocal()}
            onChange={(e) => onFrom(e.target.value)}
            required
          />
        </label>
      ) : null}
      <label className="field">
        <span>Дата до</span>
        <input
          type="date"
          value={until}
          min={minUntil}
          onChange={(e) => onUntil(e.target.value)}
          required
        />
      </label>
      <fieldset className="field absence-reason-field">
        <legend>Причина</legend>
        <div className="absence-reason-chips" role="group" aria-label="Причина">
          {ABSENCE_REASON_PRESETS.map((label) => {
            const on = reasonPreset === label;
            return (
              <button
                key={label}
                type="button"
                className={`absence-reason-chip${on ? " is-on" : ""}`}
                aria-pressed={on}
                onClick={() => onReasonPreset(label)}
              >
                {label}
              </button>
            );
          })}
        </div>
        {isOther ? (
          <textarea
            value={reasonCustom}
            onChange={(e) => onReasonCustom(e.target.value)}
            rows={compact ? 2 : 3}
            maxLength={300}
            required
            placeholder="Напиши свою причину…"
            className="absence-reason-custom"
          />
        ) : (
          <input type="hidden" value={reasonPreset} required readOnly />
        )}
      </fieldset>
    </>
  );
}
