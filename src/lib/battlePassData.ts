import { readFile } from "fs/promises";
import path from "path";
import {
  BP_LEVELS,
  type BpPlayerProgress,
} from "@/lib/battlePass";

export type BpSeasonState = {
  seasonId: string;
  enabled: boolean;
  cutoverAfterMatchId: string | null;
  scoredMatchIds: string[];
  players: Record<string, BpPlayerProgress & { finished?: boolean; name?: string }>;
  leaderboard: BpPlayerProgress[];
  updatedAt?: string;
};

function bpPath(): string {
  return (
    process.env.BP_PATH ||
    path.join(process.cwd(), "data", "public", "battle-pass.json")
  );
}

export async function loadBattlePassState(): Promise<BpSeasonState | null> {
  try {
    const raw = await readFile(bpPath(), "utf8");
    const data = JSON.parse(raw) as BpSeasonState;
    if (!data || typeof data !== "object") return null;
    return data;
  } catch {
    return null;
  }
}

export function progressForNick(
  state: BpSeasonState | null,
  nick: string
): BpPlayerProgress {
  const L1 = BP_LEVELS[0];
  const fallback: BpPlayerProgress = {
    nick,
    currentLevel: 1,
    current: 0,
    target: L1.target,
  };
  if (!state?.enabled) return fallback;
  const key = nick.trim().toLocaleLowerCase("ru");
  const players = state.players || {};
  for (const p of Object.values(players)) {
    if (!p?.nick) continue;
    if (String(p.nick).trim().toLocaleLowerCase("ru") === key) {
      const lvl = p.finished ? 20 : Number(p.currentLevel) || 1;
      // Канон порога — из BP_LEVELS, не из залипшего JSON target
      const target =
        BP_LEVELS.find((l) => l.level === lvl)?.target || L1.target;
      return {
        nick: p.nick,
        steamId: p.steamId,
        currentLevel: lvl,
        current: Math.min(Number(p.current) || 0, target),
        target,
        completedAt: p.finished ? state.updatedAt || null : null,
      };
    }
  }
  return fallback;
}

function normalizeBpRow(r: BpPlayerProgress): BpPlayerProgress {
  const lvl = Number(r.currentLevel) || 1;
  const target = BP_LEVELS.find((l) => l.level === lvl)?.target || 1;
  return {
    nick: r.nick,
    steamId: r.steamId,
    currentLevel: lvl,
    current: Math.min(Number(r.current) || 0, target),
    target,
  };
}

/** Сортировка: выше уровень / прогресс, затем ник. */
export function sortBattlePassRows(rows: BpPlayerProgress[]): BpPlayerProgress[] {
  return [...rows].sort((a, b) => {
    const sa =
      a.currentLevel +
      (a.current / Math.max(1, a.target)) * 0.99;
    const sb =
      b.currentLevel +
      (b.current / Math.max(1, b.target)) * 0.99;
    if (sb !== sa) return sb - sa;
    return String(a.nick || "").localeCompare(String(b.nick || ""), "ru", {
      sensitivity: "base",
    });
  });
}

export function battlePassLeaderboard(
  state: BpSeasonState | null
): BpPlayerProgress[] {
  if (!state?.leaderboard?.length) return [];
  return sortBattlePassRows(state.leaderboard.map(normalizeBpRow));
}

/** Топ-10 прохождения Battle Pass. */
export function battlePassLeaderboardTop10(
  state: BpSeasonState | null
): BpPlayerProgress[] {
  return battlePassLeaderboard(state).slice(0, 10);
}

export function battlePassStatusNote(_state: BpSeasonState | null): string {
  return "Участвуют только пользователи, прошедшие регистрацию.";
}
