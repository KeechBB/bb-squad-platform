import { readFile, writeFile } from "fs/promises";
import path from "path";
import {
  BP_LEVELS,
  type BpLevel,
  type BpPlayerProgress,
} from "@/lib/battlePass";
import { isBattlePassS1Ended } from "@/lib/battlePassSchedule";
import { BP_S2_LEVELS } from "@/lib/battlePassSeason2";

export type BpL20Finale = {
  mode: "closest" | "completed";
  awardedAt: string;
  nick?: string;
  steamId?: string | null;
  atLevel?: number;
  current?: number;
  target?: number;
  note: string;
};

export type BpSeasonState = {
  seasonId: string;
  enabled: boolean;
  cutoverAfterMatchId: string | null;
  scoredMatchIds: string[];
  players: Record<
    string,
    BpPlayerProgress & {
      finished?: boolean;
      finishedReason?: string;
      name?: string;
    }
  >;
  leaderboard: BpPlayerProgress[];
  updatedAt?: string;
  /** Итог S1 по медали ур. 20 (после 31.10 23:59) */
  l20Finale?: BpL20Finale | null;
};

export function isBattlePassSeason2State(
  state: BpSeasonState | null | undefined
): boolean {
  return String(state?.seasonId || "").startsWith("hw2");
}

function levelsForState(state: BpSeasonState | null | undefined): BpLevel[] {
  return isBattlePassSeason2State(state) ? BP_S2_LEVELS : BP_LEVELS;
}

function maxLevelForState(state: BpSeasonState | null | undefined): number {
  return isBattlePassSeason2State(state) ? 25 : 20;
}

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

function nickKey(nick: string): string {
  return String(nick || "")
    .trim()
    .toLocaleLowerCase("ru");
}

/** Прогресс-скор к финишу BP (finished = максимум). */
function bpProgressScore(
  p: {
    finished?: boolean;
    currentLevel?: number;
    current?: number;
    target?: number;
  },
  maxLevel = 20
): number {
  if (p.finished) return maxLevel + 1;
  const lvl = Number(p.currentLevel) || 1;
  const tgt = Math.max(1, Number(p.target) || 1);
  const cur = Math.min(Number(p.current) || 0, tgt);
  return lvl + (cur / tgt) * 0.99;
}

export type BpClosestRow = {
  nick: string;
  steamId?: string;
  currentLevel: number;
  current: number;
  target: number;
  finished: boolean;
  score: number;
};

/** Ближайший к финалу сезона (или уже finished). */
export function closestToBattlePassFinish(
  state: BpSeasonState | null
): BpClosestRow | null {
  if (!state?.players) return null;
  const levels = levelsForState(state);
  const maxLevel = maxLevelForState(state);
  const rows: BpClosestRow[] = [];
  for (const p of Object.values(state.players)) {
    if (!p?.nick) continue;
    const finished = Boolean(p.finished);
    const lvl = finished ? maxLevel : Number(p.currentLevel) || 1;
    const target =
      levels.find((l) => l.level === lvl)?.target ||
      Number(p.target) ||
      1;
    const current = finished
      ? target
      : Math.min(Number(p.current) || 0, target);
    rows.push({
      nick: p.nick,
      steamId: p.steamId,
      currentLevel: lvl,
      current,
      target,
      finished,
      score: bpProgressScore(
        {
          finished,
          currentLevel: lvl,
          current,
          target,
        },
        maxLevel
      ),
    });
  }
  if (!rows.length) return null;
  rows.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.nick.localeCompare(b.nick, "ru", { sensitivity: "base" });
  });
  return rows[0];
}

export function hasBattlePassL20Reward(
  state: BpSeasonState | null,
  nick: string
): boolean {
  if (!state || !nick) return false;
  const key = nickKey(nick);
  const finale = state.l20Finale;
  if (
    finale?.mode === "closest" &&
    finale.nick &&
    nickKey(finale.nick) === key
  ) {
    return true;
  }
  for (const p of Object.values(state.players || {})) {
    if (!p?.nick || nickKey(p.nick) !== key) continue;
    if (p.finished) return true;
    if ((Number(p.currentLevel) || 1) >= 20) return true;
  }
  return false;
}

/**
 * После 31.10 23:59: если никто не finished — медаль L20 ближайшему.
 * Идемпотентно; пишет battle-pass.json.
 */
export async function ensureBattlePassL20Finale(
  state: BpSeasonState | null
): Promise<BpSeasonState | null> {
  if (!state?.enabled || !state.players) return state;
  if (isBattlePassSeason2State(state)) return state;
  if (!isBattlePassS1Ended()) return state;
  if (state.l20Finale?.mode) return state;

  const players = state.players;
  const finishers = Object.values(players).filter(
    (p) => p?.nick && p.finished
  );
  const awardedAt = new Date().toISOString();

  if (finishers.length > 0) {
    const names = finishers.map((p) => p.nick).filter(Boolean);
    state.l20Finale = {
      mode: "completed",
      awardedAt,
      nick: names[0],
      note: `20 уровень взят: ${names.join(", ")}`,
    };
  } else {
    const lead = closestToBattlePassFinish(state);
    if (!lead?.nick) {
      state.l20Finale = {
        mode: "closest",
        awardedAt,
        note: "Сезон закрыт без участников у финиша",
      };
    } else {
      const key =
        Object.keys(players).find(
          (k) => nickKey(players[k]?.nick || "") === nickKey(lead.nick)
        ) || "";
      const p = key ? players[key] : null;
      if (p) {
        p.finished = true;
        p.finishedReason = "closest-at-season-end";
        p.currentLevel = 20;
        p.current = BP_LEVELS[19]?.target ?? 1;
        p.target = BP_LEVELS[19]?.target ?? 1;
      }
      state.l20Finale = {
        mode: "closest",
        awardedAt,
        nick: lead.nick,
        steamId: lead.steamId || p?.steamId || null,
        atLevel: lead.currentLevel,
        current: lead.current,
        target: lead.target,
        note: `Никто не достиг 20 ур. к 31.10 23:59 — «Клубничный Импульс» у ${lead.nick} (ближайший к финишу, был ур. ${lead.currentLevel})`,
      };
    }
  }

  state.updatedAt = awardedAt;
  try {
    await writeFile(bpPath(), `${JSON.stringify(state, null, 2)}\n`, "utf8");
  } catch {
    /* disk may be read-only in some contexts — UI still sees in-memory */
  }
  return state;
}

export function progressForNick(
  state: BpSeasonState | null,
  nick: string
): BpPlayerProgress {
  const levels = levelsForState(state);
  const maxLevel = maxLevelForState(state);
  const L1 = levels[0];
  const fallback: BpPlayerProgress = {
    nick,
    currentLevel: 1,
    current: 0,
    target: L1?.target || 1,
  };
  if (!state?.enabled) return fallback;
  const key = nickKey(nick);
  const players = state.players || {};
  const l20FromFinale =
    !isBattlePassSeason2State(state) && hasBattlePassL20Reward(state, nick);

  for (const p of Object.values(players)) {
    if (!p?.nick) continue;
    if (nickKey(p.nick) !== key) continue;
    const finished = Boolean(p.finished) || l20FromFinale;
    const lvl = finished ? maxLevel : Number(p.currentLevel) || 1;
    const target =
      levels.find((l) => l.level === lvl)?.target || L1?.target || 1;
    return {
      nick: p.nick,
      steamId: p.steamId,
      currentLevel: lvl,
      current: Math.min(Number(p.current) || 0, target),
      target,
      completedAt: finished
        ? state.l20Finale?.awardedAt || state.updatedAt || null
        : null,
    };
  }
  return fallback;
}

function normalizeBpRow(
  r: BpPlayerProgress,
  state: BpSeasonState | null = null
): BpPlayerProgress {
  const levels = levelsForState(state);
  const lvl = Number(r.currentLevel) || 1;
  const target = levels.find((l) => l.level === lvl)?.target || Number(r.target) || 1;
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
  return sortBattlePassRows(
    state.leaderboard.map((r) => normalizeBpRow(r, state))
  );
}

/** Нашивки и шрифты ника — чтобы в рейтинге BP светились трофеи. */
export async function withBattlePassNickCosmetics(
  rows: BpPlayerProgress[]
): Promise<BpPlayerProgress[]> {
  if (!rows.length) return rows;
  try {
    const { loadNickPatchByNick } = await import("@/lib/nickPatchesCache");
    const map = await loadNickPatchByNick();
    return rows.map((r) => {
      const key = String(r.nick || "").trim().toLowerCase();
      const cos = key ? map.get(key) : null;
      return {
        ...r,
        nickPatch: cos?.patchId || r.nickPatch || null,
        nickStyle: cos?.styleId || r.nickStyle || null,
      };
    });
  } catch {
    return rows;
  }
}

/** Топ-10 прохождения Battle Pass. */
export function battlePassLeaderboardTop10(
  state: BpSeasonState | null
): BpPlayerProgress[] {
  return battlePassLeaderboard(state).slice(0, 10);
}

export function battlePassStatusNote(state: BpSeasonState | null): string {
  const base = "Участвуют только пользователи, прошедшие регистрацию.";
  if (isBattlePassSeason2State(state)) {
    return base;
  }
  const finale = state?.l20Finale;
  if (finale?.mode === "closest" && finale.nick) {
    return `${base} Сезон закрыт: 20 ур. никто не взял — «Клубничный Импульс» у ${finale.nick} (ближайший к финишу).`;
  }
  if (finale?.mode === "completed") {
    return `${base} ${finale.note || "Сезон закрыт: 20 уровень взят."}`;
  }
  if (!isBattlePassS1Ended()) {
    const lead = closestToBattlePassFinish(state);
    if (lead && !lead.finished && lead.currentLevel < 20) {
      return (
        `${base} Если к 31.10 23:59 никто не возьмёт 20 ур. — «Клубничный Импульс» ` +
        `достанется ближайшему к финишу (сейчас ${lead.nick}, ур. ${lead.currentLevel}).`
      );
    }
  }
  return base;
}
