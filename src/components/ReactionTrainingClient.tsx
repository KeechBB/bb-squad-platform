"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  REACTION_ATTEMPTS,
  REACTION_DELAY_MAX_S,
  REACTION_DELAY_MIN_S,
  REACTION_MISS_PENALTY_MS,
  averageMs,
  formatSec3,
  roundMs3,
} from "@/lib/reaction";
import { ReactionAimChat } from "@/components/ReactionAimChat";

type LivePlayer = {
  userId: string;
  nick: string;
  avatarUrl: string | null;
  lastAvgMs: number | null;
  lastAvgL1Ms: number | null;
  lastAvgL2Ms: number | null;
};

type GlobalRecord = {
  avgMs: number;
  userId: string;
  nick: string;
};

type Phase = "idle" | "wait" | "ready" | "done";
type Level = 1 | 2;

type SessionSeries = {
  id: number;
  level: Level;
  avgMs: number;
};

function randomDelayMs() {
  const s =
    REACTION_DELAY_MIN_S +
    Math.random() * (REACTION_DELAY_MAX_S - REACTION_DELAY_MIN_S);
  return Math.round(s * 1000);
}

export function ReactionTrainingClient() {
  const [level, setLevel] = useState<Level>(1);
  const [phase, setPhase] = useState<Phase>("idle");
  const [attempts, setAttempts] = useState<number[]>([]);
  const [missFlags, setMissFlags] = useState<boolean[]>([]);
  const [live, setLive] = useState<LivePlayer[]>([]);
  const [lastAvg, setLastAvg] = useState<number | null>(null);
  const [myBest, setMyBest] = useState<number | null>(null);
  const [recordL1, setRecordL1] = useState<GlobalRecord | null>(null);
  const [recordL2, setRecordL2] = useState<GlobalRecord | null>(null);
  const [msg, setMsg] = useState("");
  const [saving, setSaving] = useState(false);
  const [circle, setCircle] = useState<{ x: number; y: number } | null>(null);
  const [sessionSeries, setSessionSeries] = useState<SessionSeries[]>([]);

  const phaseRef = useRef<Phase>("idle");
  const levelRef = useRef<Level>(1);
  const appearAtRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const arenaRef = useRef<HTMLDivElement>(null);
  const lastAvgRef = useRef<number | null>(null);
  const lastL1Ref = useRef<number | null>(null);
  const lastL2Ref = useRef<number | null>(null);
  const seriesSeqRef = useRef(0);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    levelRef.current = level;
  }, [level]);

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
          lastAvgL1Ms: lastL1Ref.current,
          lastAvgL2Ms: lastL2Ref.current,
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
      if (data.records?.l1 !== undefined) setRecordL1(data.records.l1);
      if (data.records?.l2 !== undefined) setRecordL2(data.records.l2);
    } catch {
      /* ignore */
    }
  }, []);

  const loadMyBest = useCallback(async (lv: Level) => {
    try {
      const res = await fetch(`/api/reaction/run?limit=1&level=${lv}`, {
        cache: "no-store",
      });
      if (!res.ok) return;
      const d = await res.json();
      setMyBest(d?.bestAvgMs ?? null);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void pingPresence();
    void loadLive();
    const presenceId = window.setInterval(() => void pingPresence(), 12_000);
    const liveId = window.setInterval(() => void loadLive(), 5_000);
    return () => {
      window.clearInterval(presenceId);
      window.clearInterval(liveId);
      clearTimer();
    };
  }, [pingPresence, loadLive]);

  useEffect(() => {
    if (phase !== "idle" && phase !== "done") return;
    void loadMyBest(level);
  }, [level, phase, loadMyBest]);

  function placeCircle() {
    const el = arenaRef.current;
    const w = el?.clientWidth || 400;
    const h = el?.clientHeight || 400;
    if (levelRef.current === 1) {
      setCircle({ x: w / 2, y: h / 2 });
      return;
    }
    const pad = 48;
    const x = pad + Math.random() * Math.max(40, w - pad * 2);
    const y = pad + Math.random() * Math.max(40, h - pad * 2);
    setCircle({ x, y });
  }

  function startAttempt() {
    clearTimer();
    setCircle(null);
    setPhase("wait");
    const delay = randomDelayMs();
    timerRef.current = window.setTimeout(() => {
      appearAtRef.current = performance.now();
      placeCircle();
      setPhase("ready");
      setMsg("");
    }, delay);
  }

  function startSeries() {
    setAttempts([]);
    setMissFlags([]);
    setLastAvg(null);
    setMsg("");
    startAttempt();
  }

  function selectLevel(lv: Level) {
    if (phase !== "idle" && phase !== "done") return;
    setLevel(lv);
    setAttempts([]);
    setMissFlags([]);
    setLastAvg(null);
    setMsg("");
    setCircle(null);
    setPhase("idle");
  }

  function recordAttempt(ms: number, missed: boolean) {
    const next = [...attempts, ms];
    const nextMiss = [...missFlags, missed];
    setAttempts(next);
    setMissFlags(nextMiss);
    setCircle(null);
    setMsg(
      missed
        ? `Промах · штраф ${formatSec3(REACTION_MISS_PENALTY_MS)} с`
        : ""
    );

    if (next.length >= REACTION_ATTEMPTS) {
      void finishSeries(next);
    } else {
      startAttempt();
    }
  }

  async function finishSeries(finalAttempts: number[]) {
    const avg = averageMs(finalAttempts);
    const lv = levelRef.current;
    setLastAvg(avg);
    setPhase("done");
    setCircle(null);
    setSaving(true);
    setMsg("Сохраняем…");

    if (lv === 1) lastL1Ref.current = avg;
    else lastL2Ref.current = avg;
    lastAvgRef.current = avg;

    seriesSeqRef.current += 1;
    const localId = seriesSeqRef.current;
    setSessionSeries((prev) => [
      { id: localId, level: lv, avgMs: avg },
      ...prev,
    ]);

    try {
      const res = await fetch("/api/reaction/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          attempts: finalAttempts,
          level: lv,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg(data.error || "Не удалось сохранить");
        return;
      }
      const savedAvg = data.run?.avgMs ?? avg;
      setLastAvg(savedAvg);
      if (lv === 1) lastL1Ref.current = savedAvg;
      else lastL2Ref.current = savedAvg;
      lastAvgRef.current = savedAvg;
      setSessionSeries((prev) =>
        prev.map((s) => (s.id === localId ? { ...s, avgMs: savedAvg } : s))
      );
      if (data.bestAvgMs != null) setMyBest(data.bestAvgMs);
      if (data.records?.l1 !== undefined) setRecordL1(data.records.l1);
      if (data.records?.l2 !== undefined) setRecordL2(data.records.l2);
      setMsg("Серия сохранена в профиль");
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
      clearTimer();
      recordAttempt(REACTION_MISS_PENALTY_MS, true);
      return;
    }

    const ms = roundMs3(performance.now() - appearAtRef.current);
    recordAttempt(ms, false);
  }

  const busy = phase === "wait" || phase === "ready";
  const attemptNo = Math.min(
    attempts.length + (phase === "done" || phase === "idle" ? 0 : 1),
    REACTION_ATTEMPTS
  );

  const sessionForLevel = sessionSeries
    .filter((s) => s.level === level)
    .slice()
    .reverse();

  return (
    <div className="reaction-page">
      <header className="reaction-head">
        <div>
          <p className="eyebrow">тренировка</p>
          <h1>Тренировка стрельбы</h1>
          <p className="muted" style={{ margin: "6px 0 0" }}>
            10 попыток · круг через 1–10 с · результат в секундах (например 0.730) ·
            промах = штраф 1.000 с
          </p>
        </div>
        <div className="reaction-best-chip">
          <span className="muted">Твой лучший · ур. {level}</span>
          <strong>{formatSec3(myBest)} с</strong>
        </div>
      </header>

      <div className="reaction-tabs-row">
        <div className="reaction-tabs" role="tablist" aria-label="Уровень">
          <button
            type="button"
            role="tab"
            aria-selected={level === 1}
            className={`reaction-tab${level === 1 ? " active" : ""}`}
            disabled={busy || saving}
            onClick={() => selectLevel(1)}
          >
            <strong>1 уровень</strong>
            <span>круг строго в центре</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={level === 2}
            className={`reaction-tab${level === 2 ? " active" : ""}`}
            disabled={busy || saving}
            onClick={() => selectLevel(2)}
          >
            <strong>2 уровень</strong>
            <span>круг в случайном месте</span>
          </button>
        </div>

        <div className="reaction-records" aria-label="Рекорды клана">
          <div className="reaction-record-card">
            <span className="muted">Рекорд · 1 ур</span>
            <strong>{recordL1 ? `${formatSec3(recordL1.avgMs)} с` : "—"}</strong>
            <span className="reaction-record-nick">
              {recordL1?.nick ? (
                <Link
                  className="player-nick-link"
                  href={`/players/${encodeURIComponent(recordL1.nick)}`}
                >
                  {recordL1.nick}
                </Link>
              ) : (
                "пока нет"
              )}
            </span>
          </div>
          <div className="reaction-record-card">
            <span className="muted">Рекорд · 2 ур</span>
            <strong>{recordL2 ? `${formatSec3(recordL2.avgMs)} с` : "—"}</strong>
            <span className="reaction-record-nick">
              {recordL2?.nick ? (
                <Link
                  className="player-nick-link"
                  href={`/players/${encodeURIComponent(recordL2.nick)}`}
                >
                  {recordL2.nick}
                </Link>
              ) : (
                "пока нет"
              )}
            </span>
          </div>
        </div>
      </div>

      <div className="reaction-layout">
        <aside className="reaction-board card">
          <h2>Сейчас на вкладке</h2>
          <p className="muted" style={{ marginTop: 0, fontSize: "0.82rem" }}>
            Онлайн · среднее последней серии по уровню
          </p>
          <div className="reaction-live-head">
            <span>Ник</span>
            <span>1 ур</span>
            <span>2 ур</span>
          </div>
          <ul className="reaction-live-list">
            {live.length === 0 ? (
              <li className="muted reaction-live-empty">Пока никого нет</li>
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
                    {p.lastAvgL1Ms != null ? formatSec3(p.lastAvgL1Ms) : "—"}
                  </span>
                  <span className="reaction-live-avg">
                    {p.lastAvgL2Ms != null ? formatSec3(p.lastAvgL2Ms) : "—"}
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
                    setMissFlags([]);
                    setMsg("Остановлено");
                  }}
                >
                  Стоп
                </button>
              )}
              <span className="muted">
                Попытка {attemptNo} / {REACTION_ATTEMPTS}
              </span>
            </div>
            {lastAvg != null ? (
              <div className="reaction-avg-now">
                Среднее: <strong>{formatSec3(lastAvg)} с</strong>
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
              <p className="reaction-hint">
                {level === 1
                  ? "Ур. 1 — шарик всегда в центре. Нажми «Старт» и жди кружок."
                  : "Ур. 2 — шарик в случайном месте. Нажми «Старт» и жди кружок."}
              </p>
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
                Серия завершена · среднее {formatSec3(lastAvg)} с
              </p>
            ) : null}
          </div>

          {msg ? <p className="reaction-msg">{msg}</p> : null}

          <ol className="reaction-attempts">
            {Array.from({ length: REACTION_ATTEMPTS }, (_, i) => (
              <li
                key={i}
                className={`${attempts[i] != null ? "filled" : ""}${
                  missFlags[i] ? " miss" : ""
                }`}
              >
                <span>
                  #{i + 1}
                  {missFlags[i] ? " · штраф" : ""}
                </span>
                <strong>
                  {attempts[i] != null ? `${formatSec3(attempts[i])} с` : "—"}
                </strong>
              </li>
            ))}
          </ol>
        </section>

        <div className="reaction-side-col">
          <aside className="reaction-session card">
            <h2>Этот сеанс</h2>
            <p className="muted" style={{ marginTop: 0, fontSize: "0.82rem" }}>
              Серии ур. {level} · среднее за 10 попыток
            </p>
            {sessionForLevel.length === 0 ? (
              <p className="muted" style={{ margin: "8px 0 0", fontSize: "0.85rem" }}>
                Пока пусто — заверши серию, и среднее появится здесь.
              </p>
            ) : (
              <ol className="reaction-session-list">
                {sessionForLevel.map((s, idx) => (
                  <li key={s.id}>
                    <span>
                      Серия {idx + 1}
                      <em className="muted"> · среднее</em>
                    </span>
                    <strong>{formatSec3(s.avgMs)} с</strong>
                  </li>
                ))}
              </ol>
            )}
          </aside>
          <ReactionAimChat />
        </div>
      </div>
    </div>
  );
}
