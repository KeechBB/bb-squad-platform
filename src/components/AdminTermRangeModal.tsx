"use client";

import { useMemo, useState } from "react";

export type TermRange = {
  startsAt: string; // datetime-local value
  endsAt: string;
  forever: boolean;
};

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function toLocalInput(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function addDays(base: Date, days: number): Date {
  const d = new Date(base.getTime());
  d.setDate(d.getDate() + days);
  return d;
}

type Props = {
  title: string;
  confirmLabel: string;
  steamId: string;
  nick: string;
  reasonLabel?: string;
  reasonRequired?: boolean;
  busy?: boolean;
  onClose: () => void;
  onConfirm: (payload: {
    steamId: string;
    nick: string;
    reason: string;
    startsAt: string;
    endsAt: string;
    forever: boolean;
  }) => void;
};

export function AdminTermRangeModal({
  title,
  confirmLabel,
  steamId: initialSteam,
  nick: initialNick,
  reasonLabel = "Комментарий",
  reasonRequired = false,
  busy = false,
  onClose,
  onConfirm,
}: Props) {
  const now = useMemo(() => new Date(), []);
  const [steamId, setSteamId] = useState(initialSteam);
  const [nick, setNick] = useState(initialNick);
  const [reason, setReason] = useState("");
  const [forever, setForever] = useState(false);
  const [startsAt, setStartsAt] = useState(toLocalInput(now));
  const [endsAt, setEndsAt] = useState(toLocalInput(addDays(now, 7)));

  function applyPreset(days: number | "forever") {
    if (days === "forever") {
      setForever(true);
      return;
    }
    setForever(false);
    const start = startsAt ? new Date(startsAt) : new Date();
    if (Number.isNaN(start.getTime())) return;
    setEndsAt(toLocalInput(addDays(start, days)));
  }

  return (
    <div className="panelka-modal-bg" onClick={onClose} role="presentation">
      <div
        className="panelka-modal admin-term-modal"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <header>
          <div>
            <h3>{title}</h3>
            <p className="panelka-mod-meta">Срок: календарь или пресет</p>
          </div>
          <button type="button" onClick={onClose}>
            Закрыть
          </button>
        </header>

        <div className="admin-term-body">
          <label className="field">
            <span>Steam ID</span>
            <input
              value={steamId}
              onChange={(e) => setSteamId(e.target.value.trim())}
              placeholder="7656…"
              autoComplete="off"
            />
          </label>
          <label className="field">
            <span>Ник (необязательно)</span>
            <input
              value={nick}
              onChange={(e) => setNick(e.target.value)}
              placeholder="как в игре"
              autoComplete="off"
            />
          </label>
          <label className="field">
            <span>{reasonLabel}</span>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={reasonRequired ? "обязательно" : "необязательно"}
              autoComplete="off"
            />
          </label>

          <div className="admin-term-presets" role="group" aria-label="Пресеты срока">
            <button type="button" disabled={busy} onClick={() => applyPreset(1)}>
              День
            </button>
            <button type="button" disabled={busy} onClick={() => applyPreset(7)}>
              Неделя
            </button>
            <button type="button" disabled={busy} onClick={() => applyPreset(30)}>
              Месяц
            </button>
            <button type="button" disabled={busy} onClick={() => applyPreset(90)}>
              3 месяца
            </button>
            <button type="button" disabled={busy} onClick={() => applyPreset(365)}>
              Год
            </button>
            <button
              type="button"
              className={forever ? "is-on" : ""}
              disabled={busy}
              onClick={() => applyPreset("forever")}
            >
              Навсегда
            </button>
          </div>

          <div className="admin-term-dates">
            <label className="field">
              <span>От</span>
              <input
                type="datetime-local"
                value={startsAt}
                disabled={busy}
                onChange={(e) => setStartsAt(e.target.value)}
              />
            </label>
            <label className="field">
              <span>До</span>
              <input
                type="datetime-local"
                value={endsAt}
                disabled={busy || forever}
                onChange={(e) => {
                  setForever(false);
                  setEndsAt(e.target.value);
                }}
              />
            </label>
          </div>
          {forever ? <p className="muted">Срок: бессрочно</p> : null}
        </div>

        <div className="panelka-mod-form-actions">
          <button
            type="button"
            className="btn primary"
            disabled={
              busy ||
              !/^7656\d{13}$/.test(steamId) ||
              (reasonRequired && reason.trim().length < 2) ||
              (!forever && !endsAt)
            }
            onClick={() =>
              onConfirm({
                steamId,
                nick: nick.trim(),
                reason: reason.trim(),
                startsAt,
                endsAt,
                forever,
              })
            }
          >
            {busy ? "…" : confirmLabel}
          </button>
          <button type="button" className="btn" disabled={busy} onClick={onClose}>
            Отмена
          </button>
        </div>
      </div>
    </div>
  );
}
