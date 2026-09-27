"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  REACTION_ATTEMPTS,
  REACTION_DELAY_MAX_S,
  REACTION_DELAY_MIN_S,
  REACTION_L2_PAD_PX,
  REACTION_L2_RADIUS_FRACTION,
  REACTION_MISS_PENALTY_MS,
  averageMs,
  formatSec3,
  roundMs3,
  type ReactionLevel,
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
type Level = ReactionLevel;
type PageView = "train" | "rating";

type RatingRow = {
  userId: string;
  nick: string;
  bestL1: number | null;
  runsL1: number;
  bestL2: number | null;
  runsL2: number;
};

type RatingSortKey = "nick" | "bestL1" | "runsL1" | "bestL2" | "runsL2";

type SessionSeries = {
  id: number;
  level: Level;
  avgMs: number;
};

type TargetDot = {
  id: number;
  x: number;
  y: number;
  background: string;
  shadow: string;
};

const DOT_PALETTE: Array<{ h: number; s: number; l: number }> = (() => {
  const out: Array<{ h: number; s: number; l: number }> = [];
  for (let i = 0; i < 100; i++) {
    const h = Math.round((i * 137.508) % 360);
    const s = 28 + (i % 5) * 4;
    const l = 38 + (i % 4) * 4;
    out.push({ h, s, l });
  }
  return out;
})();

function pickDotStyle() {
  const { h, s, l } = DOT_PALETTE[Math.floor(Math.random() * DOT_PALETTE.length)]!;
  const hi = `hsl(${h} ${Math.min(48, s + 6)}% ${Math.min(62, l + 16)}%)`;
  const mid = `hsl(${h} ${s}% ${l}%)`;
  const midDeep = `hsl(${h} ${Math.min(50, s + 4)}% ${Math.max(28, l - 8)}%)`;
  const dark = `hsl(${h} ${Math.min(52, s + 8)}% ${Math.max(18, l - 18)}%)`;
  const rim = `hsla(${h} ${s}% ${Math.max(14, l - 24)}% / 0.45)`;
  const soft = `hsla(${h} ${s}% ${l}% / 0.28)`;
  return {
    background: `radial-gradient(circle at 32% 28%, ${hi} 0%, ${mid} 38%, ${midDeep} 68%, ${dark} 100%)`,
    shadow: [
      `inset 0 -10px 18px ${rim}`,
      `inset 0 8px 14px hsla(0 0% 100% / 0.14)`,
      `0 10px 18px hsla(0 0% 0% / 0.45)`,
      `0 2px 4px hsla(0 0% 0% / 0.35)`,
      `0 0 0 1px ${soft}`,
    ].join(", "),
  };
}

function randomDelayMs() {
  const s =
    REACTION_DELAY_MIN_S +
    Math.random() * (REACTION_DELAY_MAX_S - REACTION_DELAY_MIN_S);
  return Math.round(s * 1000);
}

export function ReactionTrainingClient() {
  const [view, setView] = useState<PageView>("train");
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
  const [targets, setTargets] = useState<TargetDot[]>([]);
  const [sessionSeries, setSessionSeries] = useState<SessionSeries[]>([]);
  const [ratingRows, setRatingRows] = useState<RatingRow[]>([]);
  const [ratingLoading, setRatingLoading] = useState(false);
  const [ratingSortKey, setRatingSortKey] = useState<RatingSortKey>("bestL1");
  const [ratingSortDir, setRatingSortDir] = useState<"asc" | "desc">("asc");

  const phaseRef = useRef<Phase>("idle");
  const levelRef = useRef<Level>(1);
  const appearAtRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const arenaRef = useRef<HTMLDivElement>(null);
  const lastAvgRef = useRef<number | null>(null);
  const lastL1Ref = useRef<number | null>(null);
  const lastL2Ref = useRef<number | null>(null);
  const seriesSeqRef = useRef(0);
  const targetSeqRef = useRef(0);
  const targetsRef = useRef<TargetDot[]>([]);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    levelRef.current = level;
  }, [level]);

  useEffect(() => {
    lastAvgRef.current = lastAvg;
  }, [lastAvg]);

  useEffect(() => {
    targetsRef.current = targets;
  }, [targets]);

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
      const players = (data.players || []) as LivePlayer[];
      const bestOf = (p: LivePlayer) => {
        const vals = [p.lastAvgL1Ms, p.lastAvgL2Ms].filter(
          (v): v is number => v != null && Number.isFinite(v)
        );
        return vals.length ? Math.min(...vals) : null;
      };
      players.sort((a, b) => {
        const av = bestOf(a);
        const bv = bestOf(b);
        if (av == null && bv == null) {
          return String(a.nick).localeCompare(String(b.nick), "ru");
        }
        if (av == null) return 1;
        if (bv == null) return -1;
        if (av !== bv) return av - bv;
        return String(a.nick).localeCompare(String(b.nick), "ru");
      });
      setLive(players);
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

  function placeTargets() {
    const el = arenaRef.current;
    const w = el?.clientWidth || 400;
    const h = el?.clientHeight || 400;
    const cx = w / 2;
    const cy = h / 2;
    const next: TargetDot[] = [];

    if (levelRef.current === 1) {
      targetSeqRef.current += 1;
      next.push({ id: targetSeqRef.current, x: cx, y: cy, ...pickDotStyle() });
    } else {
      const pad = REACTION_L2_PAD_PX;
      const maxR = Math.max(40, Math.min(w, h) / 2 - pad);
      const r = maxR * REACTION_L2_RADIUS_FRACTION;
      const angle = Math.random() * Math.PI * 2;
      for (const a of [angle, angle + Math.PI]) {
        targetSeqRef.current += 1;
        next.push({
          id: targetSeqRef.current,
          x: cx + Math.cos(a) * r,
          y: cy + Math.sin(a) * r,
          ...pickDotStyle(),
        });
      }
    }

    targetsRef.current = next;
    setTargets(next);
  }

  function startAttempt() {
    clearTimer();
    targetsRef.current = [];
    setTargets([]);
    setPhase("wait");
    const delay = randomDelayMs();
    timerRef.current = window.setTimeout(() => {
      appearAtRef.current = performance.now();
      placeTargets();
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
    clearTimer();
    setView("train");
    setLevel(lv);
    setAttempts([]);
    setMissFlags([]);
    setLastAvg(null);
    setMsg("");
    targetsRef.current = [];
    setTargets([]);
    setPhase("idle");
  }

  async function loadLeaderboard() {
    setRatingLoading(true);
    try {
      const res = await fetch("/api/reaction/leaderboard", { cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (res.ok && Array.isArray(data?.rows)) {
        setRatingRows(data.rows as RatingRow[]);
      } else {
        setRatingRows([]);
      }
    } catch {
      setRatingRows([]);
    } finally {
      setRatingLoading(false);
    }
  }

  function openRating() {
    if (phase !== "idle" && phase !== "done") return;
    clearTimer();
    setView("rating");
    setPhase("idle");
    targetsRef.current = [];
    setTargets([]);
    setMsg("");
    void loadLeaderboard();
  }

  function toggleRatingSort(key: RatingSortKey) {
    if (ratingSortKey === key) {
      setRatingSortDir((d) => (d === "asc" ? "desc" : "asc"));
      return;
    }
    setRatingSortKey(key);
    if (key === "bestL1" || key === "bestL2" || key === "nick") {
      setRatingSortDir("asc");
    } else {
      setRatingSortDir("desc");
    }
  }

  const sortedRatingRows = (() => {
    const dir = ratingSortDir === "asc" ? 1 : -1;
    const rows = ratingRows.slice();
    rows.sort((a, b) => {
      if (ratingSortKey === "nick") {
        return dir * String(a.nick).localeCompare(String(b.nick), "ru");
      }
      const av = a[ratingSortKey];
      const bv = b[ratingSortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      const an = Number(av);
      const bn = Number(bv);
      if (an === bn) return String(a.nick).localeCompare(String(b.nick), "ru");
      return dir * (an - bn);
    });
    return rows;
  })();

  const topBestL1 = ratingRows.reduce<number | null>((best, r) => {
    if (r.bestL1 == null) return best;
    return best == null || r.bestL1 < best ? r.bestL1 : best;
  }, null);
  const topBestL2 = ratingRows.reduce<number | null>((best, r) => {
    if (r.bestL2 == null) return best;
    return best == null || r.bestL2 < best ? r.bestL2 : best;
  }, null);

  function renderRecordCell(value: number | null, top: number | null) {
    if (value == null) return "—";
    const text = `${formatSec3(value)} с`;
    if (top != null && value === top) {
      return (
        <span className="reaction-rating-record">
          {text}
          <span className="reaction-rating-cup" aria-hidden>
            🏆
          </span>
        </span>
      );
    }
    return text;
  }

  function rememberLevelResult(lv: Level, value: number) {
    if (lv === 1) lastL1Ref.current = value;
    else lastL2Ref.current = value;
    lastAvgRef.current = value;
  }

  function recordAttempt(ms: number, missed: boolean) {
    const next = [...attempts, ms];
    const nextMiss = [...missFlags, missed];
    setAttempts(next);
    setMissFlags(nextMiss);
    targetsRef.current = [];
    setTargets([]);
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
    targetsRef.current = [];
    setTargets([]);
    setSaving(true);
    setMsg("Сохраняем…");
    rememberLevelResult(lv, avg);

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
      rememberLevelResult(lv, savedAvg);
      setSessionSeries((prev) =>
        prev.map((s) => (s.id === localId ? { ...s, avgMs: savedAvg } : s))
      );
      if (data.bestAvgMs != null) setMyBest(data.bestAvgMs);
      if (data.records?.l1 !== undefined) setRecordL1(data.records.l1);
      if (data.records?.l2 !== undefined) setRecordL2(data.records.l2);
      setMsg("Серия сохранена");
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
      setMsg("Рано! Жди шарик — эта попытка заново.");
      targetsRef.current = [];
      setTargets([]);
      startAttempt();
      return;
    }
    if (phaseRef.current !== "ready" || !targetsRef.current.length) return;

    const target = e.target as HTMLElement;
    const hit = target.closest(".reaction-dot") as HTMLElement | null;
    if (!hit?.dataset.targetId) {
      clearTimer();
      recordAttempt(REACTION_MISS_PENALTY_MS, true);
      return;
    }

    const id = Number(hit.dataset.targetId);
    const remaining = targetsRef.current.filter((t) => t.id !== id);
    if (remaining.length === targetsRef.current.length) return;

    targetsRef.current = remaining;
    setTargets(remaining);

    if (remaining.length === 0) {
      const ms = roundMs3(performance.now() - appearAtRef.current);
      recordAttempt(ms, false);
    }
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
            {level === 1
              ? "10 попыток · круг в центре через 1–10 с · среднее в секундах · промах = штраф 1.000 с"
              : "10 попыток · 2 шарика на равном расстоянии от центра · среднее в секундах · промах = штраф 1.000 с"}
          </p>
        </div>
        <div className="reaction-best-chip reaction-best-chip-l1">
          <span className="muted">Твой лучший · ур. {level}</span>
          <strong>
            {myBest != null ? `${formatSec3(myBest)} с` : "—"}
          </strong>
        </div>
      </header>

      <div className="reaction-tabs-row">
        <div className="reaction-tabs" role="tablist" aria-label="Уровень">
          <button
            type="button"
            role="tab"
            aria-selected={view === "train" && level === 1}
            className={`reaction-tab${view === "train" && level === 1 ? " active" : ""}`}
            disabled={busy || saving}
            onClick={() => selectLevel(1)}
          >
            <strong>1 уровень</strong>
            <span>круг строго в центре</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === "train" && level === 2}
            className={`reaction-tab${view === "train" && level === 2 ? " active" : ""}`}
            disabled={busy || saving}
            onClick={() => selectLevel(2)}
          >
            <strong>2 уровень</strong>
            <span>2 шарика · от центра</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === "rating"}
            className={`reaction-tab${view === "rating" ? " active" : ""}`}
            disabled={busy || saving}
            onClick={() => openRating()}
          >
            <strong>Рейтинг</strong>
            <span>общий по игрокам</span>
          </button>
        </div>

        {view === "train" ? (
          <div className="reaction-records" aria-label="Рекорды клана">
            <div className="reaction-record-card">
              <span className="muted">Рекорд · 1 ур</span>
              <strong>
                {recordL1 ? `${formatSec3(recordL1.avgMs)} с` : "—"}
              </strong>
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
              <strong>
                {recordL2 ? `${formatSec3(recordL2.avgMs)} с` : "—"}
              </strong>
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
        ) : null}
      </div>

      {view === "rating" ? (
        <section className="card reaction-rating-panel">
          <div className="reaction-rating-head">
            <div>
              <h2>Общий рейтинг</h2>
              <p className="muted" style={{ margin: "4px 0 0" }}>
                Все, кто проходил тренировку · клик по столбцу — сортировка
              </p>
            </div>
            <button
              type="button"
              className="btn ghost"
              disabled={ratingLoading}
              onClick={() => void loadLeaderboard()}
            >
              {ratingLoading ? "Обновляем…" : "Обновить"}
            </button>
          </div>
          <div className="reaction-rating-wrap">
            <table className="reaction-rating-table">
              <thead>
                <tr>
                  {(
                    [
                      ["nick", "Ник"],
                      ["bestL1", "1 ур · рекорд"],
                      ["runsL1", "1 ур · серии"],
                      ["bestL2", "2 ур · рекорд"],
                      ["runsL2", "2 ур · серии"],
                    ] as const
                  ).map(([key, label]) => {
                    const active = ratingSortKey === key;
                    const arrow = active
                      ? ratingSortDir === "asc"
                        ? " ▲"
                        : " ▼"
                      : "";
                    return (
                      <th key={key}>
                        <button
                          type="button"
                          className={`reaction-rating-sort${active ? " is-sorted" : ""}`}
                          onClick={() => toggleRatingSort(key)}
                        >
                          {label}
                          {arrow}
                        </button>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {ratingLoading && ratingRows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="muted">
                      Загружаем…
                    </td>
                  </tr>
                ) : sortedRatingRows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="muted">
                      Пока никто не играл
                    </td>
                  </tr>
                ) : (
                  sortedRatingRows.map((r) => (
                    <tr key={r.userId}>
                      <td>
                        <Link
                          className="player-nick-link"
                          href={`/players/${encodeURIComponent(r.nick)}`}
                        >
                          {r.nick}
                        </Link>
                      </td>
                      <td>{renderRecordCell(r.bestL1, topBestL1)}</td>
                      <td>{r.runsL1 || "—"}</td>
                      <td>{renderRecordCell(r.bestL2, topBestL2)}</td>
                      <td>{r.runsL2 || "—"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      ) : (
        <div className="reaction-layout">
          <aside className="reaction-board card">
            <h2>Сейчас на вкладке</h2>
            <p className="muted" style={{ marginTop: 0, fontSize: "0.82rem" }}>
              Онлайн · последняя серия по уровню
            </p>
            <div className="reaction-live-head reaction-live-head-2">
              <span>Ник</span>
              <span>1</span>
              <span>2</span>
            </div>
            <ul className="reaction-live-list">
              {live.length === 0 ? (
                <li className="muted reaction-live-empty">Пока никого нет</li>
              ) : (
                live.map((p) => (
                  <li key={p.userId} className="reaction-live-row-2">
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
                      targetsRef.current = [];
                      setTargets([]);
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
              className="reaction-arena"
              onClick={onArenaClick}
              role="presentation"
            >
              {phase === "idle" ? (
                <p className="reaction-hint">
                  {level === 1
                    ? "Ур. 1 — шарик всегда в центре. Нажми «Старт» и жди."
                    : "Ур. 2 — два шарика на равном расстоянии от центра. Кликни оба — время до второго попадания."}
                </p>
              ) : null}
              {phase === "wait" ? (
                <p className="reaction-hint">Жди… не кликай раньше времени</p>
              ) : null}
              {phase === "ready"
                ? targets.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      className="reaction-dot"
                      data-target-id={t.id}
                      style={{
                        left: t.x,
                        top: t.y,
                        background: t.background,
                        boxShadow: t.shadow,
                      }}
                      aria-label="Цель"
                    />
                  ))
                : null}
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
                <p
                  className="muted"
                  style={{ margin: "8px 0 0", fontSize: "0.85rem" }}
                >
                  Пока пусто — заверши серию, и результат появится здесь.
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
      )}
    </div>
  );
}
