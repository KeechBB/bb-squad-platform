"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  REACTION_ATTEMPTS,
  REACTION_DELAY_MAX_S,
  REACTION_DELAY_MIN_S,
  averageMs,
  formatMs3,
  roundMs3,
} from "@/lib/reaction";

type LivePlayer = {
  userId: string;
  nick: string;
  avatarUrl: string | null;
  lastAvgMs: number | null;
};

type Phase = "idle" | "wait" | "ready" | "done";

function randomDelayMs() {
  const s =
    REACTION_DELAY_MIN_S +
    Math.random() * (REACTION_DELAY_MAX_S - REACTION_DELAY_MIN_S);
  return Math.round(s * 1000);
}

export function ReactionTrainingClient() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [attempts, setAttempts] = useState<number[]>([]);
  const [live, setLive] = useState<LivePlayer[]>([]);
  const [lastAvg, setLastAvg] = useState<number | null>(null);
  const [bestAvg, setBestAvg] = useState<number | null>(null);
  const [msg, setMsg] = useState("");
  const [saving, setSaving] = useState(false);
  const [circle, setCircle] = useState<{ x: number; y: number } | null>(null);

  const phaseRef = useRef<Phase>("idle");
  const appearAtRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const arenaRef = useRef<HTMLDivElement>(null);
  const lastAvgRef = useRef<number | null>(null);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    lastAvgRef.current = lastAvg;
  }, [lastAvg]);

  const clearTimer = () => {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const pingPresence = useCallback(async () => {
    try {
      await fetch("/api/reaction/presence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lastAvgMs: lastAvgRef.current,
        }),
        cache: "no-store",
      });
    } catch {
      /* ignore */
    }
  }, []);

  const loadLive = useCallback(async () => {
    try {
      const res = await fetch("/api/reaction/presence", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setLive(data.players || []);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void pingPresence();
    void loadLive();
    const presenceId = window.setInterval(() => void pingPresence(), 12_000);
    const liveId = window.setInterval(() => void loadLive(), 5_000);
    fetch("/api/reaction/run?limit=1", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.bestAvgMs != null) setBestAvg(d.bestAvgMs);
      })
      .catch(() => {});
    return () => {
      window.clearInterval(presenceId);
      window.clearInterval(liveId);
      clearTimer();
    };
  }, [pingPresence, loadLive]);

  function placeCircle() {
    const el = arenaRef.current;
    const pad = 48;
    const w = el?.clientWidth || 400;
    const h = el?.clientHeight || 400;
    const x = pad + Math.random() * Math.max(40, w - pad * 2);
    const y = pad + Math.random() * Math.max(40, h - pad * 2);
    setCircle({ x, y });
  }

  function startAttempt() {
    clearTimer();
    setMsg("");
    setCircle(null);
    setPhase("wait");
    const delay = randomDelayMs();
    timerRef.current = window.setTimeout(() => {
      appearAtRef.current = performance.now();
      placeCircle();
      setPhase("ready");
    }, delay);
  }

  function startSeries() {
    setAttempts([]);
    setLastAvg(null);
    setMsg("");
    startAttempt();
  }

  async function finishSeries(finalAttempts: number[]) {
    const avg = averageMs(finalAttempts);
    setLastAvg(avg);
    setPhase("done");
    setCircle(null);
    setSaving(true);
    setMsg("Сохраняем…");
    try {
      const res = await fetch("/api/reaction/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attempts: finalAttempts, level: 1 }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg(data.error || "Не удалось сохранить");
        return;
      }
      setLastAvg(data.run?.avgMs ?? avg);
      if (data.bestAvgMs != null) setBestAvg(data.bestAvgMs);
      setMsg("Серия сохранена в профиль");
      lastAvgRef.current = data.run?.avgMs ?? avg;
      void pingPresence();
      void loadLive();
    } catch {
      setMsg("Сеть недоступна — результат не сохранён");
    } finally {
      setSaving(false);
    }
  }

  function onArenaClick(e: React.MouseEvent) {
    if (phaseRef.current === "wait") {
      clearTimer();
      setMsg("Рано! Жди круг — эта попытка заново.");
      setCircle(null);
      startAttempt();
      return;
    }
    if (phaseRef.current !== "ready" || !circle) return;

    const target = e.target as HTMLElement;
    if (!target.closest(".reaction-dot")) {
      setMsg("Промах — попытка заново.");
      clearTimer();
      setCircle(null);
      startAttempt();
      return;
    }

    const ms = roundMs3(performance.now() - appearAtRef.current);
    const next = [...attempts, ms];
    setAttempts(next);
    setCircle(null);
    setMsg("");

    if (next.length >= REACTION_ATTEMPTS) {
      void finishSeries(next);
    } else {
      startAttempt();
    }
  }

  return (
    <div className="reaction-page">
      <header className="reaction-head">
        <div>
          <p className="eyebrow">тренировка</p>
          <h1>Тренировка стрельбы</h1>
          <p className="muted" style={{ margin: "6px 0 0" }}>
            Уровень 1 — реакция. Круг появляется через 1–10 с · 10 попыток ·
            среднее до 0.001 мс
          </p>
        </div>
        <div className="reaction-best-chip">
          <span className="muted">Твой лучший</span>
          <strong>{formatMs3(bestAvg)} мс</strong>
        </div>
      </header>

      <div className="reaction-layout">
        <aside className="reaction-board card">
          <h2>Сейчас на вкладке</h2>
          <p className="muted" style={{ marginTop: 0, fontSize: "0.82rem" }}>
            Онлайн здесь · средний результат серии
          </p>
          <ul className="reaction-live-list">
            {live.length === 0 ? (
              <li className="muted">Пока никого нет</li>
            ) : (
              live.map((p) => (
                <li key={p.userId}>
                  <span className="reaction-live-nick">
                    {p.nick ? (
                      <Link
                        className="player-nick-link"
                        href={`/players/${encodeURIComponent(p.nick)}`}
                      >
                        {p.nick}
                      </Link>
                    ) : (
                      "Игрок"
                    )}
                  </span>
                  <span className="reaction-live-avg">
                    {p.lastAvgMs != null ? `${formatMs3(p.lastAvgMs)} мс` : "—"}
                  </span>
                </li>
              ))
            )}
          </ul>
        </aside>

        <section className="reaction-main card">
          <div className="reaction-main-top">
            <div className="reaction-controls">
              {phase === "idle" || phase === "done" ? (
                <button
                  type="button"
                  className="btn primary"
                  disabled={saving}
                  onClick={startSeries}
                >
                  {phase === "done" ? "Ещё раз" : "Старт · 10 попыток"}
                </button>
              ) : (
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => {
                    clearTimer();
                    setPhase("idle");
                    setCircle(null);
                    setAttempts([]);
                    setMsg("Остановлено");
                  }}
                >
                  Стоп
                </button>
              )}
              <span className="muted">
                Попытка {Math.min(attempts.length + (phase === "done" ? 0 : phase === "idle" ? 0 : 1), REACTION_ATTEMPTS)} /{" "}
                {REACTION_ATTEMPTS}
              </span>
            </div>
            {lastAvg != null ? (
              <div className="reaction-avg-now">
                Среднее: <strong>{formatMs3(lastAvg)} мс</strong>
              </div>
            ) : null}
          </div>

          <div
            ref={arenaRef}
            className={`reaction-arena phase-${phase}`}
            onClick={onArenaClick}
            role="presentation"
          >
            {phase === "idle" ? (
              <p className="reaction-hint">Нажми «Старт» и жди кружок</p>
            ) : null}
            {phase === "wait" ? (
              <p className="reaction-hint">Жди… не кликай раньше времени</p>
            ) : null}
            {phase === "ready" && circle ? (
              <button
                type="button"
                className="reaction-dot"
                style={{ left: circle.x, top: circle.y }}
                aria-label="Цель"
              />
            ) : null}
            {phase === "done" ? (
              <p className="reaction-hint">
                Серия завершена · среднее {formatMs3(lastAvg)} мс
              </p>
            ) : null}
          </div>

          {msg ? <p className="reaction-msg">{msg}</p> : null}

          <ol className="reaction-attempts">
            {Array.from({ length: REACTION_ATTEMPTS }, (_, i) => (
              <li key={i} className={attempts[i] != null ? "filled" : ""}>
                <span>#{i + 1}</span>
                <strong>
                  {attempts[i] != null ? `${formatMs3(attempts[i])} мс` : "—"}
                </strong>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </div>
  );
}
