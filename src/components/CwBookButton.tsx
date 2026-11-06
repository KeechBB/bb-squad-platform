"use client";

import { useCallback, useEffect, useId, useState } from "react";

type StepId =
  | "team"
  | "size"
  | "date"
  | "time"
  | "map"
  | "server"
  | "rules"
  | "confirm";

const STEPS: { id: StepId; title: string; hint: string; placeholder: string }[] =
  [
    {
      id: "team",
      title: "Кто играет?",
      hint: "Состав BB и соперник",
      placeholder: "BB Main vs 20Royals",
    },
    {
      id: "size",
      title: "Размер",
      hint: "Сколько в стеке",
      placeholder: "26v26",
    },
    {
      id: "date",
      title: "Дата",
      hint: "День.месяц (МСК-календарь)",
      placeholder: "08.11",
    },
    {
      id: "time",
      title: "Время",
      hint: "Старт по UTC",
      placeholder: "17:00 UTC",
    },
    {
      id: "map",
      title: "Карта",
      hint: "Как в заявке / слое",
      placeholder: "SEC_26_Sanxian_AAS v1",
    },
    {
      id: "server",
      title: "Сервер",
      hint: "Где играем",
      placeholder: "20R",
    },
    {
      id: "rules",
      title: "Правила",
      hint: "Мод / регламент",
      placeholder: "SEC",
    },
  ];

type Answers = Record<Exclude<StepId, "confirm">, string>;

const EMPTY: Answers = {
  team: "",
  size: "",
  date: "",
  time: "",
  map: "",
  server: "",
  rules: "",
};

export function CwBookButton() {
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Answers>(EMPTY);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ id: string } | null>(null);

  const total = STEPS.length;
  const onConfirm = step >= total;
  const current = onConfirm ? null : STEPS[step];

  const reset = useCallback(() => {
    setStep(0);
    setAnswers(EMPTY);
    setDraft("");
    setError(null);
    setDone(null);
    setBusy(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, busy]);

  function openWizard() {
    reset();
    setOpen(true);
  }

  function applyStepValue(value: string) {
    if (!current) return;
    const v = value.trim();
    if (!v) {
      setError("Нужен ответ");
      return;
    }
    setAnswers((prev) => ({ ...prev, [current.id]: v }));
    setError(null);
    setDraft("");
    setStep((s) => s + 1);
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/cw-book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          teamLine: answers.team,
          size: answers.size,
          date: answers.date,
          time: answers.time,
          map: answers.map,
          server: answers.server,
          rules: answers.rules,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        id?: string;
        error?: string;
        hint?: string;
      };
      if (!res.ok || !data.ok) {
        setError(data.hint || data.error || `Ошибка ${res.status}`);
        setBusy(false);
        return;
      }
      setDone({ id: String(data.id || "") });
    } catch {
      setError("Сеть недоступна");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="cw-book-nav-btn"
        title="Зарегистрировать будущую КВ"
        aria-label="Рега КВ"
        onClick={openWizard}
      >
        <span className="cw-book-nav-label">Рега КВ</span>
      </button>

      {open ? (
        <div
          className="cw-book-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !busy) setOpen(false);
          }}
        >
          <div className="cw-book-card">
            <header className="cw-book-head">
              <p className="cw-book-eyebrow">Клановая война</p>
              <h2 id={titleId} className="cw-book-title">
                {done
                  ? "Слот в календаре"
                  : onConfirm
                    ? "Проверь заявку"
                    : current?.title}
              </h2>
              {!done ? (
                <p className="cw-book-sub">
                  {onConfirm
                    ? "После подтверждения попадёт в /cw и на главную"
                    : current?.hint}
                </p>
              ) : null}
              {!done && !onConfirm ? (
                <p className="cw-book-step">
                  Шаг {step + 1} / {total}
                </p>
              ) : null}
            </header>

            {done ? (
              <div className="cw-book-done">
                <p>
                  Готово — <b>{done.id}</b> в календаре (upcoming).
                </p>
                <p className="muted">
                  Обнови /cw или главную, если превью ещё старое.
                </p>
                <button
                  type="button"
                  className="btn primary"
                  onClick={() => setOpen(false)}
                >
                  Закрыть
                </button>
              </div>
            ) : onConfirm ? (
              <div className="cw-book-confirm">
                <ul className="cw-book-summary">
                  <li>
                    <span>Команды</span>
                    <b>{answers.team}</b>
                  </li>
                  <li>
                    <span>Размер</span>
                    <b>{answers.size}</b>
                  </li>
                  <li>
                    <span>Дата</span>
                    <b>{answers.date}</b>
                  </li>
                  <li>
                    <span>Время</span>
                    <b>{answers.time}</b>
                  </li>
                  <li>
                    <span>Карта</span>
                    <b>{answers.map}</b>
                  </li>
                  <li>
                    <span>Сервер</span>
                    <b>{answers.server}</b>
                  </li>
                  <li>
                    <span>Правила</span>
                    <b>{answers.rules}</b>
                  </li>
                </ul>
                {error ? <p className="error">{error}</p> : null}
                <div className="cw-book-actions">
                  <button
                    type="button"
                    className="btn"
                    disabled={busy}
                    onClick={() => {
                      setError(null);
                      setStep(total - 1);
                      setDraft(answers.rules);
                    }}
                  >
                    Назад
                  </button>
                  <button
                    type="button"
                    className="btn primary"
                    disabled={busy}
                    onClick={() => void submit()}
                  >
                    {busy ? "Пишу…" : "В календарь"}
                  </button>
                </div>
              </div>
            ) : (
              <form
                className="cw-book-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  applyStepValue(draft);
                }}
              >
                <label className="cw-book-field">
                  <span className="sr-only">{current?.title}</span>
                  <input
                    autoFocus
                    className="cw-book-input"
                    value={draft}
                    placeholder={current?.placeholder}
                    onChange={(e) => {
                      setDraft(e.target.value);
                      setError(null);
                    }}
                  />
                </label>
                {error ? <p className="error">{error}</p> : null}
                <div className="cw-book-actions">
                  <button
                    type="button"
                    className="btn"
                    disabled={busy || step === 0}
                    onClick={() => {
                      if (step === 0) return;
                      const prev = STEPS[step - 1];
                      setStep(step - 1);
                      setDraft(answers[prev.id] || "");
                      setError(null);
                    }}
                  >
                    Назад
                  </button>
                  <button type="submit" className="btn primary" disabled={busy}>
                    Далее
                  </button>
                </div>
              </form>
            )}

            <button
              type="button"
              className="cw-book-close"
              aria-label="Закрыть"
              disabled={busy}
              onClick={() => setOpen(false)}
            >
              ×
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
