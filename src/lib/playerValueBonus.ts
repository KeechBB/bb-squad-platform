/**
 * Бонусы к «Стоимости» в составе фракции:
 *  - победа КВ Main (участник) +10 000
 *  - победа КВ Junior (участник) +5 000
 *  - разовый бонус стартовому Main-составу +50 000
 */
import { prisma } from "@/lib/prisma";
import { nickCompact, nicksMatch } from "@/lib/nickIdentity";
import {
  collisionBySteamId,
  isCollidingAngelNick,
  profileHistoryKey,
} from "@/lib/nickCollisions";

export const CW_WIN_BONUS_MAIN = 10_000;
export const CW_WIN_BONUS_JUNIOR = 5_000;
export const MAIN_ROSTER_FOUNDING_BONUS = 50_000;

/** Стартовый Main-состав — разовый +50k к стоимости. */
export const MAIN_ROSTER_FOUNDING_NICKS = [
  "ikeppa",
  "Treppen",
  "qop",
  "JESTER",
  "Diray",
  "Angel",
  "Lordwolf",
  "Chidori",
  "CAT",
  "AkiN",
  "Killreal",
  "Runetik",
  "S.M.P",
  "Lepurple",
  "Radislave",
  "Zensu",
  "Hikkomaru",
  "Pymba",
  "Gadler",
  "KuchenChips",
] as const;

export type PlayerValueBonusBreakdown = {
  mainWins: number;
  juniorWins: number;
  cwBonus: number;
  foundingBonus: number;
  total: number;
};

function emptyBonus(): PlayerValueBonusBreakdown {
  return { mainWins: 0, juniorWins: 0, cwBonus: 0, foundingBonus: 0, total: 0 };
}

function isFoundingMember(opts: {
  nick: string;
  steamName?: string | null;
  steamId?: string | null;
}): boolean {
  const nick = String(opts.nick || "").trim();
  const steamName = String(opts.steamName || "").trim();
  for (const listed of MAIN_ROSTER_FOUNDING_NICKS) {
    // Angel в списке = Саня BB (siteNick angel / AngelBB), не Алан.
    if (listed === "Angel") {
      if (collisionBySteamId(opts.steamId)?.siteNick === "angel") return true;
      if (nick === "angel" || nick.toLowerCase() === "angelbb") return true;
      continue;
    }
    if (nicksMatch(listed, nick) || (steamName && nicksMatch(listed, steamName))) {
      return true;
    }
  }
  return false;
}

function stackNorm(raw: unknown): "Main" | "Junior" | null {
  const s = String(raw || "").trim().toLowerCase();
  if (s === "main") return "Main";
  if (s === "junior") return "Junior";
  return null;
}

function payloadWon(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") return false;
  const p = payload as Record<string, unknown>;
  if (p.won === true) return true;
  const st = String(p.status || "").trim().toLowerCase();
  return st === "win";
}

function payloadStack(payload: unknown): "Main" | "Junior" | null {
  if (!payload || typeof payload !== "object") return null;
  return stackNorm((payload as Record<string, unknown>).stack);
}

/**
 * Бонусы стоимости по userId для переданного состава.
 * Победы КВ — из ProfileMatchLine (kind=cw), уже с nickKey/steam для Angel.
 */
export async function loadPlayerValueBonuses(
  members: {
    userId: string;
    nick: string;
    steamName?: string | null;
    steamId?: string | null;
  }[],
): Promise<Map<string, PlayerValueBonusBreakdown>> {
  const out = new Map<string, PlayerValueBonusBreakdown>();
  if (!members.length) return out;

  const historyToUser = new Map<string, string>();
  for (const m of members) {
    out.set(m.userId, emptyBonus());
    const cell = out.get(m.userId)!;
    if (isFoundingMember(m)) {
      cell.foundingBonus = MAIN_ROSTER_FOUNDING_BONUS;
      cell.total = MAIN_ROSTER_FOUNDING_BONUS;
    }
    const hk = profileHistoryKey(m.nick, m.steamId);
    if (hk) historyToUser.set(hk, m.userId);
    // Запасной ключ без steam — но не для Angel/angel (коллизия).
    if (!isCollidingAngelNick(m.nick) && !collisionBySteamId(m.steamId)) {
      const plain = nickCompact(m.nick);
      if (plain && !historyToUser.has(plain)) historyToUser.set(plain, m.userId);
      const sn = nickCompact(m.steamName || "");
      if (sn && !historyToUser.has(sn)) historyToUser.set(sn, m.userId);
    }
  }

  const nickKeys = [...historyToUser.keys()];
  if (!nickKeys.length) return out;

  const lines = await prisma.profileMatchLine.findMany({
    where: { kind: "cw", nickKey: { in: nickKeys } },
    select: { nickKey: true, matchId: true, payload: true },
  });

  const mainWins = new Map<string, Set<string>>();
  const juniorWins = new Map<string, Set<string>>();

  for (const line of lines) {
    if (!payloadWon(line.payload)) continue;
    const stack = payloadStack(line.payload);
    if (!stack) continue;
    const userId = historyToUser.get(line.nickKey);
    if (!userId) continue;
    const bucket = stack === "Main" ? mainWins : juniorWins;
    let set = bucket.get(userId);
    if (!set) {
      set = new Set();
      bucket.set(userId, set);
    }
    set.add(line.matchId);
  }

  for (const m of members) {
    const cell = out.get(m.userId)!;
    cell.mainWins = mainWins.get(m.userId)?.size || 0;
    cell.juniorWins = juniorWins.get(m.userId)?.size || 0;
    cell.cwBonus =
      cell.mainWins * CW_WIN_BONUS_MAIN + cell.juniorWins * CW_WIN_BONUS_JUNIOR;
    cell.total = cell.cwBonus + cell.foundingBonus;
  }

  return out;
}
