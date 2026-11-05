"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

export type HomeCwCard = {
  id: string;
  stack: "Main" | "Junior" | "Clan";
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
  cards: HomeCwCard[];
};

export function HomeCwAnnounce({ cards: initial }: Props) {
  const [cards, setCards] = useState(initial);
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    setCards(initial);
  }, [initial]);

  // Подтягиваем актуальные слоты с сервера (перенос даты / обнуление «буду»).
  useEffect(() => {
    let cancelled = false;
    async function pull() {
      try {
        const res = await fetch("/api/cw-announce", { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { cards?: HomeCwCard[] };
        if (!cancelled && Array.isArray(data.cards)) setCards(data.cards);
      } catch {
        /* keep SSR */
      }
    }
    void pull();
    const id = window.setInterval(pull, 45_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  useEffect(() => {
    if (!openId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openId]);

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
      setCards((cur) =>
        cur.map((prev) =>
          prev.id === card.id
            ? {
                ...prev,
                going: Boolean(data.going),
                ready: data.ready || [],
              }
            : prev
        )
      );
    } catch {
      setErr("Нет связи");
    } finally {
      setBusy(null);
    }
  }

  const opened = cards.find((card) => card.id === openId) || null;
  const clanAside = cards.some((card) => card.stack !== "Clan");
  const column = clanAside ? cards.filter((card) => card.stack !== "Clan") : cards;
  const clan = clanAside ? cards.filter((card) => card.stack === "Clan") : [];

  return (
    <div className="home-cw-slot">
    <div className="home-cw-pair" aria-label="Ближайшие клановые войны">
      {column.length ? (
        column.map((card) => (
          <CwFace
            key={card.id}
            card={card}
            stack={card.stack}
            busy={busy}
            onOpen={() => setOpenId(card.id)}
            onToggle={toggle}
          />
        ))
      ) : (
        <CwFace card={null} stack="Main" busy={null} onOpen={() => {}} onToggle={toggle} />
      )}
      {err ? <p className="home-cw-err">{err}</p> : null}
    </div>
    {clan.length ? (
      <div className="home-cw-clan" aria-label="КВ всего клана">
        {clan.map((card) => (
          <CwFace
            key={card.id}
            card={card}
            stack={card.stack}
            busy={busy}
            onOpen={() => setOpenId(card.id)}
            onToggle={toggle}
          />
        ))}
      </div>
    ) : null}
      {opened
        ? createPortal(
            <div
              className="home-cw-modal"
              role="presentation"
                onClick={() => setOpenId(null)}
            >
              <div
                className="home-cw-modal-card"
                role="dialog"
                aria-modal="true"
                aria-label={`КВ ${opened.stack === "Clan" ? "весь клан" : opened.stack}`}
                onClick={(e) => e.stopPropagation()}
              >
                <header>
                  <span>КВ · {opened.stack === "Clan" ? "весь клан" : opened.stack}</span>
                  <button type="button" onClick={() => setOpenId(null)}>
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
  stack: "Main" | "Junior" | "Clan";
  busy: string | null;
  onOpen: () => void;
  onToggle: (card: HomeCwCard) => void;
}) {
  return (
    <section className="home-cw-card">
      <p className="home-cw-kicker">
        КВ · {stack === "Clan" ? "весь клан" : stack}
      </p>
      {card ? (
        <>
          <div className="home-cw-open">
            <span className="home-cw-date">{card.dateLabel}</span>
            <span className="home-cw-time">{card.timeMsk}</span>
            <span className="home-cw-opp">против {card.opp}</span>
            <span className="home-cw-map">
              {card.map}
              {card.size ? ` · ${card.size}` : ""}
            </span>
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
          <button
            type="button"
            className="home-cw-predict"
            disabled
            title="Скоро"
          >
            Прогноз · в разработке
          </button>
        </>
      ) : (
        <>
          <p className="home-cw-empty">Ближайших матчей нет</p>
          <button
            type="button"
            className="home-cw-predict"
            disabled
            title="Скоро"
          >
            Прогноз · в разработке
          </button>
        </>
      )}
    </section>
  );
}
