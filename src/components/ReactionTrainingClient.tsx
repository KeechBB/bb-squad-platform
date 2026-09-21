"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  REACTION_ATTEMPTS,
  REACTION_DELAY_MAX_S,
  REACTION_DELAY_MIN_S,
  REACTION_L3_BALL_LIFE_MS,
  REACTION_L3_DURATION_MS,
  REACTION_L3_HIT_POINTS,
  REACTION_L3_MISS_POINTS,
  REACTION_L3_SPAWN_EVERY_MS,
  REACTION_L3_SPAWN_MAX,
  REACTION_L3_SPAWN_MIN,
  REACTION_MISS_PENALTY_MS,
  averageMs,
  formatScore,
  formatSec3,
  isScoreLevel,
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
  lastAvgL3Ms: number | null;
};

type GlobalRecord = {
  avgMs: number;
  userId: string;
  nick: string;
};

type Phase = "idle" | "wait" | "ready" | "play" | "done";
type Level = ReactionLevel;
type PageView = "train" | "rating";

type RatingRow = {
  userId: string;
  nick: string;
  bestL1: number | null;
  runsL1: number;
  bestL2: number | null;
  runsL2: number;
  bestL3: number | null;
  runsL3: number;
};

type RatingSortKey =
  | "nick"
  | "bestL1"
  | "runsL1"
  | "bestL2"
  | "runsL2"
  | "bestL3"
  | "runsL3";

type SessionSeries = {
  id: number;
  level: Level;
  avgMs: number;
};

type L3Ball = {
  id: number;
  x: number;
  y: number;
  expiresAt: number;
  background: string;
  shadow: string;
};

/** ~100 матовых цветов для шариков */
const DOT_PALETTE: Array<{ h: number; s: number; l: number }> = (() => {
  const out: Array<{ h: number; s: number; l: number }> = [];
  for (let i = 0; i < 100; i++) {
    const h = Math.round((i * 137.508) % 360);
    const s = 28 + (i % 5) * 4; // 28–44 — приглушённо
    const l = 38 + (i % 4) * 4; // 38–50 — матовый средний тон
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
    background: [
      `radial-gradient(circle at 32% 28%, ${hi} 0%, ${mid} 38%, ${midDeep} 68%, ${dark} 100%)`,
    ].join(", "),
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

function spawnCount() {
  return (
    REACTION_L3_SPAWN_MIN +
    Math.floor(
      Math.random() * (REACTION_L3_SPAWN_MAX - REACTION_L3_SPAWN_MIN + 1)
    )
  );
}

function formatRecord(level: Level, rec: GlobalRecord | null) {
  if (!rec) return "—";
  return isScoreLevel(level)
    ? `${formatScore(rec.avgMs)} оч.`
    : `${formatSec3(rec.avgMs)} с`;
}

function formatResult(level: Level, value: number | null) {
  if (value == null) return "—";
  return isScoreLevel(level) ? `${formatScore(value)} оч.` : `${formatSec3(value)} с`;
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
  const [recordL3, setRecordL3] = useState<GlobalRecord | null>(null);
  const [msg, setMsg] = useState("");
  const [saving, setSaving] = useState(false);
  const [circle, setCircle] = useState<{
    x: number;
    y: number;
    background: string;
    shadow: string;
  } | null>(null);
  const [sessionSeries, setSessionSeries] = useState<SessionSeries[]>([]);
  const [l3Balls, setL3Balls] = useState<L3Ball[]>([]);
  const [l3Score, setL3Score] = useState(0);
  const [l3Hits, setL3Hits] = useState(0);
  const [l3Misses, setL3Misses] = useState(0);
  const [l3LeftMs, setL3LeftMs] = useState(REACTION_L3_DURATION_MS);
  const [ratingRows, setRatingRows] = useState<RatingRow[]>([]);
  const [ratingLoading, setRatingLoading] = useState(false);
  const [ratingSortKey, setRatingSortKey] = useState<RatingSortKey>("bestL1");
  const [ratingSortDir, setRatingSortDir] = useState<"asc" | "desc">("asc");

  const phaseRef = useRef<Phase>("idle");
  const levelRef = useRef<Level>(1);
  const appearAtRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const spawnTimerRef = useRef<number | null>(null);
  const endTimerRef = useRef<number | null>(null);
  const tickTimerRef = useRef<number | null>(null);
  const arenaRef = useRef<HTMLDivElement>(null);
  const lastAvgRef = useRef<number | null>(null);
  const lastL1Ref = useRef<number | null>(null);
  const lastL2Ref = useRef<number | null>(null);
  const lastL3Ref = useRef<number | null>(null);
  const seriesSeqRef = useRef(0);
  const ballSeqRef = useRef(0);
  const l3ScoreRef = useRef(0);
  const l3HitsRef = useRef(0);
  const l3MissesRef = useRef(0);
  const l3StartRef = useRef(0);
  const l3BallsRef = useRef<L3Ball[]>([]);

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
    l3BallsRef.current = l3Balls;
  }, [l3Balls]);

  const clearTimer = () => {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const clearL3Timers = () => {
    if (spawnTimerRef.current != null) {
      window.clearInterval(spawnTimerRef.current);
      spawnTimerRef.current = null;
    }
    if (endTimerRef.current != null) {
      window.clearTimeout(endTimerRef.current);
      endTimerRef.current = null;
    }
    if (tickTimerRef.current != null) {
      window.clearInterval(tickTimerRef.current);
      tickTimerRef.current = null;
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
          lastAvgL3Ms: lastL3Ref.current,
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
      if (data.records?.l3 !== undefined) setRecordL3(data.records.l3);
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
      clearL3Timers();
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
    const style = pickDotStyle();
    if (levelRef.current === 1) {
      setCircle({ x: w / 2, y: h / 2, ...style });
      return;
    }
    const pad = levelRef.current === 2 ? 84 : 64;
    const x = pad + Math.random() * Math.max(40, w - pad * 2);
    const y = pad + Math.random() * Math.max(40, h - pad * 2);
    setCircle({ x, y, ...style });
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
    if (levelRef.current === 3) {
      startL3();
      return;
    }
    setAttempts([]);
    setMissFlags([]);
    setLastAvg(null);
    setMsg("");
    startAttempt();
  }

  function pruneL3Balls(now = performance.now()) {
    const next = l3BallsRef.current.filter((b) => b.expiresAt > now);
    if (next.length !== l3BallsRef.current.length) {
      l3BallsRef.current = next;
      setL3Balls(next);
    }
  }

  function spawnL3Wave() {
    const el = arenaRef.current;
    const w = el?.clientWidth || 400;
    const h = el?.clientHeight || 400;
    const pad = 52;
    const now = performance.now();
    pruneL3Balls(now);
    const count = spawnCount();
    const added: L3Ball[] = [];
    for (let i = 0; i < count; i++) {
      ballSeqRef.current += 1;
      const style = pickDotStyle();
      added.push({
        id: ballSeqRef.current,
        x: pad + Math.random() * Math.max(40, w - pad * 2),
        y: pad + Math.random() * Math.max(40, h - pad * 2),
        expiresAt: now + REACTION_L3_BALL_LIFE_MS,
        background: style.background,
        shadow: style.shadow,
      });
    }
    const next = [...l3BallsRef.current, ...added];
    l3BallsRef.current = next;
    setL3Balls(next);
  }

  function finishL3() {
    clearL3Timers();
    pruneL3Balls();
    setL3Balls([]);
    l3BallsRef.current = [];
    const score = l3ScoreRef.current;
    const hits = l3HitsRef.current;
    const misses = l3MissesRef.current;
    setL3LeftMs(0);
    void finishScoreRun(score, hits, misses);
  }

  function startL3() {
    clearTimer();
    clearL3Timers();
    setAttempts([]);
    setCircle(null);
    setLastAvg(null);
    setMsg("");
    setL3Balls([]);
    l3BallsRef.current = [];
    ballSeqRef.current = 0;
    l3ScoreRef.current = 0;
    l3HitsRef.current = 0;
    l3MissesRef.current = 0;
    setL3Score(0);
    setL3Hits(0);
    setL3Misses(0);
    setL3LeftMs(REACTION_L3_DURATION_MS);
    l3StartRef.current = performance.now();
    setPhase("play");
    spawnL3Wave();
    spawnTimerRef.current = window.setInterval(() => {
      if (phaseRef.current !== "play") return;
      spawnL3Wave();
    }, REACTION_L3_SPAWN_EVERY_MS);
    tickTimerRef.current = window.setInterval(() => {
      if (phaseRef.current !== "play") return;
      const left = Math.max(
        0,
        REACTION_L3_DURATION_MS - (performance.now() - l3StartRef.current)
      );
      setL3LeftMs(left);
      pruneL3Balls();
    }, 100);
    endTimerRef.current = window.setTimeout(() => {
      finishL3();
    }, REACTION_L3_DURATION_MS);
  }

  function selectLevel(lv: Level) {
    if (phase !== "idle" && phase !== "done") return;
    clearTimer();
    clearL3Timers();
    setView("train");
    setLevel(lv);
    setAttempts([]);
    setMissFlags([]);
    setLastAvg(null);
    setMsg("");
    setCircle(null);
    setL3Balls([]);
    l3BallsRef.current = [];
    setL3Score(0);
    setL3Hits(0);
    setL3Misses(0);
    setL3LeftMs(REACTION_L3_DURATION_MS);
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
    clearL3Timers();
    setView("rating");
    setPhase("idle");
    setCircle(null);
    setL3Balls([]);
    l3BallsRef.current = [];
    setMsg("");
    void loadLeaderboard();
  }

  function toggleRatingSort(key: RatingSortKey) {
    if (ratingSortKey === key) {
      setRatingSortDir((d) => (d === "asc" ? "desc" : "asc"));
      return;
    }
    setRatingSortKey(key);
    // время — сначала лучшие (asc); очки и счётчики — сначала больше (desc); ник — A→Я
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
      const aNull = av == null;
      const bNull = bv == null;
      if (aNull && bNull) return 0;
      if (aNull) return 1;
      if (bNull) return -1;
      const an = Number(av);
      const bn = Number(bv);
      if (an === bn) return String(a.nick).localeCompare(String(b.nick), "ru");
      return dir * (an - bn);
    });
    return rows;
  })();

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

  function rememberLevelResult(lv: Level, value: number) {
    if (lv === 1) lastL1Ref.current = value;
    else if (lv === 2) lastL2Ref.current = value;
    else lastL3Ref.current = value;
    lastAvgRef.current = value;
  }

  async function finishSeries(finalAttempts: number[]) {
    const avg = averageMs(finalAttempts);
    const lv = levelRef.current;
    setLastAvg(avg);
    setPhase("done");
    setCircle(null);
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
      if (data.records?.l3 !== undefined) setRecordL3(data.records.l3);
      setMsg("Серия сохранена в профиль");
      void pingPresence();
      void loadLive();
    } catch {
      setMsg("Сеть недоступна — результат не сохранён");
    } finally {
      setSaving(false);
    }
  }

  async function finishScoreRun(score: number, hits: number, misses: number) {
    const lv = 3 as Level;
    setLastAvg(score);
    setPhase("done");
    setSaving(true);
    setMsg("Сохраняем…");
    rememberLevelResult(lv, score);

    seriesSeqRef.current += 1;
    const localId = seriesSeqRef.current;
    setSessionSeries((prev) => [
      { id: localId, level: lv, avgMs: score },
      ...prev,
    ]);

    try {
      const res = await fetch("/api/reaction/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ level: 3, score, hits, misses }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg(data.error || "Не удалось сохранить");
        return;
      }
      const saved = data.run?.avgMs ?? score;
      setLastAvg(saved);
      rememberLevelResult(lv, saved);
      setSessionSeries((prev) =>
        prev.map((s) => (s.id === localId ? { ...s, avgMs: saved } : s))
      );
      if (data.bestAvgMs != null) setMyBest(data.bestAvgMs);
      if (data.records?.l1 !== undefined) setRecordL1(data.records.l1);
      if (data.records?.l2 !== undefined) setRecordL2(data.records.l2);
      if (data.records?.l3 !== undefined) setRecordL3(data.records.l3);
      setMsg(`Раунд сохранён · ${formatScore(saved)} оч.`);
      void pingPresence();
      void loadLive();
    } catch {
      setMsg("Сеть недоступна — результат не сохранён");
    } finally {
      setSaving(false);
    }
  }

  function onArenaClick(e: React.MouseEvent) {
    if (levelRef.current === 3) {
      if (phaseRef.current !== "play") return;
      const target = e.target as HTMLElement;
      const hit = target.closest(".reaction-dot") as HTMLElement | null;
      if (hit?.dataset.ballId) {
        const id = Number(hit.dataset.ballId);
        const next = l3BallsRef.current.filter((b) => b.id !== id);
        if (next.length === l3BallsRef.current.length) return;
        l3BallsRef.current = next;
        setL3Balls(next);
        l3HitsRef.current += 1;
        l3ScoreRef.current += REACTION_L3_HIT_POINTS;
        setL3Hits(l3HitsRef.current);
        setL3Score(l3ScoreRef.current);
        setMsg(`+${REACTION_L3_HIT_POINTS}`);
        return;
      }
      l3MissesRef.current += 1;
      l3ScoreRef.current += REACTION_L3_MISS_POINTS;
      setL3Misses(l3MissesRef.current);
      setL3Score(l3ScoreRef.current);
      setMsg(`${REACTION_L3_MISS_POINTS}`);
      return;
    }

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

  const busy =
    phase === "wait" || phase === "ready" || phase === "play";
  const attemptNo = Math.min(
    attempts.length + (phase === "done" || phase === "idle" ? 0 : 1),
    REACTION_ATTEMPTS
  );

  const sessionForLevel = sessionSeries
    .filter((s) => s.level === level)
    .slice()
    .reverse();

  const l3SecLeft = Math.ceil(l3LeftMs / 1000);

  return (
    <div className="reaction-page">
      <header className="reaction-head">
        <div>
          <p className="eyebrow">тренировка</p>
          <h1>Тренировка стрельбы</h1>
          <p className="muted" style={{ margin: "6px 0 0" }}>
            {level === 3
              ? "30 с · каждые 0.4 с 3–5 шариков · живут 1.1 с · попадание +10 · промах −5"
              : "10 попыток · круг через 1–10 с · результат в секундах · промах = штраф 1.000 с"}
          </p>
        </div>
        <div className="reaction-best-chip">
          <span className="muted">Твой лучший · ур. {level}</span>
          <strong>{formatResult(level, myBest)}</strong>
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
            <span>круг в случайном месте</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === "train" && level === 3}
            className={`reaction-tab${view === "train" && level === 3 ? " active" : ""}`}
            disabled={busy || saving}
            onClick={() => selectLevel(3)}
          >
            <strong>3 уровень</strong>
            <span>волна шариков · очки</span>
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
            <strong>{formatRecord(1, recordL1)}</strong>
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
            <strong>{formatRecord(2, recordL2)}</strong>
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
          <div className="reaction-record-card">
            <span className="muted">Рекорд · 3 ур</span>
            <strong>{formatRecord(3, recordL3)}</strong>
            <span className="reaction-record-nick">
              {recordL3?.nick ? (
                <Link
                  className="player-nick-link"
                  href={`/players/${encodeURIComponent(recordL3.nick)}`}
                >
                  {recordL3.nick}
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
                      ["runsL1", "1 ур · попытки"],
                      ["bestL2", "2 ур · рекорд"],
                      ["runsL2", "2 ур · попытки"],
                      ["bestL3", "3 ур · рекорд"],
                      ["runsL3", "3 ур · попытки"],
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
                    <td colSpan={7} className="muted">
                      Загружаем…
                    </td>
                  </tr>
                ) : sortedRatingRows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="muted">
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
                      <td>
                        {r.bestL1 != null ? `${formatSec3(r.bestL1)} с` : "—"}
                      </td>
                      <td>{r.runsL1 || "—"}</td>
                      <td>
                        {r.bestL2 != null ? `${formatSec3(r.bestL2)} с` : "—"}
                      </td>
                      <td>{r.runsL2 || "—"}</td>
                      <td>
                        {r.bestL3 != null ? `${formatScore(r.bestL3)} оч.` : "—"}
                      </td>
                      <td>{r.runsL3 || "—"}</td>
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
          <div className="reaction-live-head reaction-live-head-3">
            <span>Ник</span>
            <span>1</span>
            <span>2</span>
            <span>3</span>
          </div>
          <ul className="reaction-live-list">
            {live.length === 0 ? (
              <li className="muted reaction-live-empty">Пока никого нет</li>
            ) : (
              live.map((p) => (
                <li key={p.userId} className="reaction-live-row-3">
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
                  <span className="reaction-live-avg">
                    {p.lastAvgL3Ms != null ? formatScore(p.lastAvgL3Ms) : "—"}
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
                  {phase === "done"
                    ? "Ещё раз"
                    : level === 3
                      ? "Старт · 30 секунд"
                      : "Старт · 10 попыток"}
                </button>
              ) : (
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => {
                    clearTimer();
                    clearL3Timers();
                    setPhase("idle");
                    setCircle(null);
                    setAttempts([]);
                    setMissFlags([]);
                    setL3Balls([]);
                    l3BallsRef.current = [];
                    setMsg("Остановлено");
                  }}
                >
                  Стоп
                </button>
              )}
              {level === 3 ? (
                <span className="muted">
                  {phase === "play"
                    ? `${l3SecLeft} с · ${formatScore(l3Score)} оч.`
                    : "30 секунд · +10 / −5"}
                </span>
              ) : (
                <span className="muted">
                  Попытка {attemptNo} / {REACTION_ATTEMPTS}
                </span>
              )}
            </div>
            {lastAvg != null && phase !== "play" ? (
              <div className="reaction-avg-now">
                {level === 3 ? (
                  <>
                    Счёт: <strong>{formatScore(lastAvg)} оч.</strong>
                  </>
                ) : (
                  <>
                    Среднее: <strong>{formatSec3(lastAvg)} с</strong>
                  </>
                )}
              </div>
            ) : null}
            {phase === "play" ? (
              <div className="reaction-avg-now">
                Попадания {l3Hits} · промахи {l3Misses}
              </div>
            ) : null}
          </div>

          <div
            ref={arenaRef}
            className={`reaction-arena phase-${phase}${
              level === 2 ? " level-2" : ""
            }${level === 3 ? " level-3" : ""}`}
            onClick={onArenaClick}
            role="presentation"
          >
            {phase === "idle" ? (
              <p className="reaction-hint">
                {level === 1
                  ? "Ур. 1 — шарик всегда в центре. Нажми «Старт» и жди кружок."
                  : level === 2
                    ? "Ур. 2 — большой шарик в случайном месте. Нажми «Старт»."
                    : "Ур. 3 — 30 секунд волны шариков. Попадание +10, промах −5."}
              </p>
            ) : null}
            {phase === "wait" ? (
              <p className="reaction-hint">Жди… не кликай раньше времени</p>
            ) : null}
            {phase === "ready" && circle ? (
              <button
                type="button"
                className={`reaction-dot${level === 2 ? " reaction-dot-lg" : ""}`}
                style={{
                  left: circle.x,
                  top: circle.y,
                  background: circle.background,
                  boxShadow: circle.shadow,
                }}
                aria-label="Цель"
              />
            ) : null}
            {phase === "play"
              ? l3Balls.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    className="reaction-dot reaction-dot-l3"
                    data-ball-id={b.id}
                    style={{
                      left: b.x,
                      top: b.y,
                      background: b.background,
                      boxShadow: b.shadow,
                    }}
                    aria-label="Цель"
                  />
                ))
              : null}
            {phase === "done" ? (
              <p className="reaction-hint">
                {level === 3
                  ? `Раунд завершён · ${formatScore(lastAvg)} оч.`
                  : `Серия завершена · среднее ${formatSec3(lastAvg)} с`}
              </p>
            ) : null}
          </div>

          {msg ? <p className="reaction-msg">{msg}</p> : null}

          {level === 3 ? (
            <div className="reaction-l3-stats">
              <div>
                <span className="muted">Счёт</span>
                <strong>{formatScore(phase === "play" ? l3Score : lastAvg)}</strong>
              </div>
              <div>
                <span className="muted">Попадания</span>
                <strong>{phase === "play" || phase === "done" ? l3Hits : "—"}</strong>
              </div>
              <div>
                <span className="muted">Промахи</span>
                <strong>{phase === "play" || phase === "done" ? l3Misses : "—"}</strong>
              </div>
            </div>
          ) : (
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
          )}
        </section>

        <div className="reaction-side-col">
          <aside className="reaction-session card">
            <h2>Этот сеанс</h2>
            <p className="muted" style={{ marginTop: 0, fontSize: "0.82rem" }}>
              {level === 3
                ? `Раунды ур. ${level} · итоговый счёт`
                : `Серии ур. ${level} · среднее за 10 попыток`}
            </p>
            {sessionForLevel.length === 0 ? (
              <p className="muted" style={{ margin: "8px 0 0", fontSize: "0.85rem" }}>
                Пока пусто — заверши{" "}
                {level === 3 ? "раунд" : "серию"}, и результат появится здесь.
              </p>
            ) : (
              <ol className="reaction-session-list">
                {sessionForLevel.map((s, idx) => (
                  <li key={s.id}>
                    <span>
                      {level === 3 ? "Раунд" : "Серия"} {idx + 1}
                      <em className="muted">
                        {level === 3 ? " · счёт" : " · среднее"}
                      </em>
                    </span>
                    <strong>{formatResult(level, s.avgMs)}</strong>
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
