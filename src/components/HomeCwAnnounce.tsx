"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

export type HomeCwCard = {
  id: string;
  stack: "Main" | "Junior";
  dateLabel: string;
  timeMsk: string;
  opp: string;
  map: string;
  size: string;
  server: string;
  rules: string;
  ready: string[];
  going: boolean;
};

type Props = {
  main: HomeCwCard | null;
  junior: HomeCwCard | null;
};

export function HomeCwAnnounce({ main, junior }: Props) {
  const [cards, setCards] = useState({ main, junior });
  const [open, setOpen] = useState<"main" | "junior" | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    setCards({ main, junior });
  }, [main, junior]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  async function toggle(card: HomeCwCard) {
    if (!card.id || busy) return;
    setBusy(card.id);
    setErr("");
    try {
      const res = await fetch("/api/cw-ready", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ matchId: card.id }),
      });
      const raw = await res.text();
      let data: {
        going?: boolean;
        ready?: string[];
        error?: string;
      } = {};
      try {
        data = raw ? (JSON.parse(raw) as typeof data) : {};
      } catch {
        setErr(res.ok ? "Странный ответ сервера" : `Ошибка ${res.status}`);
        return;
      }
      if (!res.ok) {
        setErr(data.error || "Не вышло записать");
        return;
      }
      setCards((cur) => {
        const next = { ...cur };
        const key = card.stack === "Main" ? "main" : "junior";
        const prev = next[key];
        if (prev && prev.id === card.id) {
          next[key] = {
            ...prev,
            going: Boolean(data.going),
            ready: data.ready || [],
          };
        }
        return next;
      });
    } catch {
      setErr("Нет связи");
    } finally {
      setBusy(null);
    }
  }

  const opened =
    open === "main" ? cards.main : open === "junior" ? cards.junior : null;

  return (
    <div className="home-cw-pair" aria-label="Ближайшие клановые войны">
      <CwFace
        card={cards.main}
        stack="Main"
        busy={busy}
        onOpen={() => setOpen("main")}
        onToggle={toggle}
      />
      <CwFace
        card={cards.junior}
        stack="Junior"
        busy={busy}
        onOpen={() => setOpen("junior")}
        onToggle={toggle}
      />
      {err ? <p className="home-cw-err">{err}</p> : null}
      {opened && open
        ? createPortal(
            <div
              className="home-cw-modal"
              role="presentation"
              onClick={() => setOpen(null)}
            >
              <div
                className="home-cw-modal-card"
                role="dialog"
                aria-modal="true"
                aria-label={`КВ ${opened.stack}`}
                onClick={(e) => e.stopPropagation()}
              >
                <header>
                  <span>КВ · {opened.stack}</span>
                  <button type="button" onClick={() => setOpen(null)}>
                    закрыть
                  </button>
                </header>
                <p className="home-cw-modal-when">
                  {opened.dateLabel} · {opened.timeMsk} · против {opened.opp}
                </p>
                <ul className="home-cw-facts">
                  <li>
                    <span>Карта</span>
                    <b>{opened.map}</b>
                  </li>
                  <li>
                    <span>Формат</span>
                    <b>{opened.size}</b>
                  </li>
                  <li>
                    <span>Сервер</span>
                    <b>{opened.server}</b>
                  </li>
                  <li>
                    <span>Правила</span>
                    <b>{opened.rules}</b>
                  </li>
                </ul>
                <p className="home-cw-ready-title">Кто будет</p>
                {opened.ready.length ? (
                  <ol className="home-cw-ready-list">
                    {opened.ready.map((nick, i) => (
                      <li key={`${nick}-${i}`}>{nick}</li>
                    ))}
                  </ol>
                ) : (
                  <p className="home-cw-ready-empty">Пока никто не отметился</p>
                )}
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}

function CwFace({
  card,
  stack,
  busy,
  onOpen,
  onToggle,
}: {
  card: HomeCwCard | null;
  stack: "Main" | "Junior";
  busy: string | null;
  onOpen: () => void;
  onToggle: (card: HomeCwCard) => void;
}) {
  return (
    <section className="home-cw-card">
      <p className="home-cw-kicker">КВ · {stack}</p>
      {card ? (
        <>
          <div className="home-cw-open">
            <span className="home-cw-date">{card.dateLabel}</span>
            <span className="home-cw-time">{card.timeMsk}</span>
            <span className="home-cw-opp">против {card.opp}</span>
          </div>
          <button type="button" className="home-cw-roster" onClick={onOpen}>
            Кто в составе
          </button>
          <button
            type="button"
            className={`home-cw-go${card.going ? " is-on" : ""}`}
            disabled={busy === card.id}
            onClick={() => onToggle(card)}
          >
            {card.going ? "Участие подтверждено" : "БУДУ НА КВ"}
          </button>
        </>
      ) : (
        <p className="home-cw-empty">Ближайших матчей нет</p>
      )}
    </section>
  );
}
