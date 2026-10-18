import { readFile } from "fs/promises";
import path from "path";
import {
  BP_LEVELS,
  BP_SEASON,
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
      const target =
        Number(p.target) ||
        BP_LEVELS.find((l) => l.level === lvl)?.target ||
        L1.target;
      return {
        nick: p.nick,
        steamId: p.steamId,
        currentLevel: lvl,
        current: Number(p.current) || 0,
        target,
        completedAt: p.finished ? state.updatedAt || null : null,
      };
    }
  }
  return fallback;
}

export function battlePassLeaderboard(
  state: BpSeasonState | null
): BpPlayerProgress[] {
  if (!state?.leaderboard?.length) return [];
  return state.leaderboard.slice(0, 20).map((r) => ({
    nick: r.nick,
    steamId: r.steamId,
    currentLevel: Number(r.currentLevel) || 1,
    current: Number(r.current) || 0,
    target:
      Number(r.target) ||
      BP_LEVELS.find((l) => l.level === Number(r.currentLevel))?.target ||
      1,
  }));
}

export function battlePassStatusNote(state: BpSeasonState | null): string {
  if (!state?.enabled) {
    return "Подсчёт ещё не включён.";
  }
  const cut = state.cutoverAfterMatchId;
  if (cut) {
    return `Считаем с карты после ${cut}. Сезон: ${BP_SEASON.subtitle}.`;
  }
  return `Подсчёт включён. Сезон: ${BP_SEASON.subtitle}.`;
}
