/**
 * Бонусы к «Стоимости» в составе фракции:
 *  - победа КВ Main (участник) +10 000 — только с 17.11.2026
 *  - победа КВ Junior (участник) +5 000 — только с 17.11.2026
 *  - разовый бонус стартовому Main-составу +50 000
 */
import { prisma } from "@/lib/prisma";
import { nickCompact, nicksMatch } from "@/lib/nickIdentity";
import {
  BB_ANGEL_STEAM_ID,
  collisionBySteamId,
  isBbAngelSteam,
  isCollidingAngelNick,
  profileHistoryKey,
  resolveFactionAngel,
} from "@/lib/nickCollisions";

export const CW_WIN_BONUS_MAIN = 10_000;
export const CW_WIN_BONUS_JUNIOR = 5_000;
export const MAIN_ROSTER_FOUNDING_BONUS = 50_000;
/** Победы КВ в стоимость только с этой даты (включительно, YYYY-MM-DD МСК-календарь). */
export const CW_VALUE_BONUS_FROM_YMD = "2026-11-17";

/** Стартовый Main-состав — разовый +50k к стоимости. */
export const MAIN_ROSTER_FOUNDING_NICKS = [
  "ikeppa",
  "Treppen",
  "qop",
  "JESTER",
  "Diray",
  /** Саня BB (steam закреплён в isFoundingMember). */
  "angel",
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
    // angel = только Саня BB (steam 76561198941350361), не Алан и не «angel ·8062».
    if (listed.toLowerCase() === "angel") {
      if (isBbAngelSteam(opts.steamId)) return true;
      if (collisionBySteamId(opts.steamId)) continue; // Алан и т.п.
      const fa = resolveFactionAngel(opts);
      if (fa && fa.steamId === BB_ANGEL_STEAM_ID) return true;
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
    where: {
      kind: "cw",
      nickKey: { in: nickKeys },
      playedOn: { gte: CW_VALUE_BONUS_FROM_YMD },
    },
    select: { nickKey: true, matchId: true, playedOn: true, payload: true },
  });

  const mainWins = new Map<string, Set<string>>();
  const juniorWins = new Map<string, Set<string>>();

  for (const line of lines) {
    if (String(line.playedOn || "") < CW_VALUE_BONUS_FROM_YMD) continue;
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

export type MyValueEvent = {
  at: string;
  day: string;
  kind: "founding" | "grind" | "cw_main" | "cw_junior";
  label: string;
  delta: number;
};

export type MyValuePoint = {
  day: string;
  label: string;
  market: number;
  grind: number;
  cw: number;
  founding: number;
  total: number;
};

export type MyValueReport = {
  nick: string;
  kit: string | null;
  marketValue: number;
  grindBroughtBd: number;
  estimate: number;
  mainCwWins: number;
  juniorCwWins: number;
  cwBonus: number;
  foundingBonus: number;
  total: number;
  series: MyValuePoint[];
  events: MyValueEvent[];
};

function mskYmd(d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function shiftYmd(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(
    dt.getUTCDate(),
  ).padStart(2, "0")}`;
}

function dayLabel(ymd: string): string {
  return `${ymd.slice(8, 10)}.${ymd.slice(5, 7)}`;
}

/**
 * Отчёт «моя стоимость» для модалки: разбивка + ряд за 14д + события.
 * Рынок в динамике — текущий (плоская база); гринд/КВ/founding нарастают.
 */
export async function loadMyValueReport(opts: {
  userId: string;
  nick: string;
  steamName?: string | null;
  steamId?: string | null;
  marketValue: number;
  grindBroughtBd: number;
  estimate: number;
  kit?: string | null;
}): Promise<MyValueReport> {
  const bonuses = await loadPlayerValueBonuses([
    {
      userId: opts.userId,
      nick: opts.nick,
      steamName: opts.steamName,
      steamId: opts.steamId,
    },
  ]);
  const bonus = bonuses.get(opts.userId) || emptyBonus();
  const market = Math.max(0, Math.round(opts.marketValue || 0));
  const grind = Math.max(0, Math.round(opts.grindBroughtBd || 0));
  const total = market + grind + bonus.total;

  const factionAngel = resolveFactionAngel({
    nick: opts.nick,
    steamName: opts.steamName,
    steamId: opts.steamId,
  });
  const steamForHistory = factionAngel?.steamId || opts.steamId;
  const nickForHistory = factionAngel?.siteNick || opts.nick;
  const hk = profileHistoryKey(nickForHistory, steamForHistory);
  const keys = new Set<string>([hk].filter(Boolean));
  // Для angel никогда не подмешиваем plain «angel» без steam — иначе чужие КВ.
  if (
    !factionAngel &&
    !isCollidingAngelNick(opts.nick) &&
    !collisionBySteamId(opts.steamId)
  ) {
    const plain = nickCompact(opts.nick);
    if (plain) keys.add(plain);
    const sn = nickCompact(opts.steamName || "");
    if (sn) keys.add(sn);
  }

  const [grindRows, cwLines] = await Promise.all([
    prisma.factionLedgerEntry.findMany({
      where: { kind: "grind", userId: opts.userId, amount: { gt: 0 } },
      orderBy: { createdAt: "asc" },
      select: { amount: true, createdAt: true, note: true, matchId: true },
      take: 400,
    }),
    keys.size
      ? prisma.profileMatchLine.findMany({
          where: {
            kind: "cw",
            nickKey: { in: [...keys] },
            playedOn: { gte: CW_VALUE_BONUS_FROM_YMD },
          },
          select: { matchId: true, playedOn: true, payload: true, map: true },
          orderBy: { playedOn: "asc" },
        })
      : Promise.resolve([]),
  ]);

  const events: MyValueEvent[] = [];
  if (bonus.foundingBonus > 0) {
    events.push({
      at: `${CW_VALUE_BONUS_FROM_YMD}T00:00:00.000Z`,
      day: CW_VALUE_BONUS_FROM_YMD,
      kind: "founding",
      label: "Бонус стартового Main-состава",
      delta: bonus.foundingBonus,
    });
  }

  const seenCw = new Set<string>();
  for (const line of cwLines) {
    if (!payloadWon(line.payload)) continue;
    const stack = payloadStack(line.payload);
    if (!stack) continue;
    if (seenCw.has(line.matchId)) continue;
    seenCw.add(line.matchId);
    const delta = stack === "Main" ? CW_WIN_BONUS_MAIN : CW_WIN_BONUS_JUNIOR;
    const map = String(line.map || "").trim();
    events.push({
      at: `${line.playedOn}T12:00:00.000Z`,
      day: line.playedOn,
      kind: stack === "Main" ? "cw_main" : "cw_junior",
      label: `Победа КВ ${stack}${map ? ` · ${map}` : ""}`,
      delta,
    });
  }

  for (const g of grindRows) {
    const day = mskYmd(g.createdAt);
    events.push({
      at: g.createdAt.toISOString(),
      day,
      kind: "grind",
      label: String(g.note || "Гринд TR").trim() || "Гринд TR",
      delta: g.amount,
    });
  }

  events.sort((a, b) => a.at.localeCompare(b.at) || a.delta - b.delta);

  const today = mskYmd();
  const from = shiftYmd(today, -13);
  const days: string[] = [];
  for (let i = 0; i < 14; i++) days.push(shiftYmd(from, i));

  const grindByDay = new Map<string, number>();
  for (const g of grindRows) {
    const day = mskYmd(g.createdAt);
    grindByDay.set(day, (grindByDay.get(day) || 0) + g.amount);
  }
  const cwByDay = new Map<string, number>();
  for (const e of events) {
    if (e.kind !== "cw_main" && e.kind !== "cw_junior") continue;
    cwByDay.set(e.day, (cwByDay.get(e.day) || 0) + e.delta);
  }

  let grindCum = 0;
  let cwCum = 0;
  // гринд/КВ до окна — в базу первого дня
  for (const [day, n] of grindByDay) {
    if (day < from) grindCum += n;
  }
  for (const [day, n] of cwByDay) {
    if (day < from) cwCum += n;
  }
  const founding = bonus.foundingBonus;

  const series: MyValuePoint[] = days.map((day) => {
    grindCum += grindByDay.get(day) || 0;
    cwCum += cwByDay.get(day) || 0;
    return {
      day,
      label: dayLabel(day),
      market,
      grind: grindCum,
      cw: cwCum,
      founding,
      total: market + grindCum + cwCum + founding,
    };
  });

  const recentEvents = [...events].reverse().slice(0, 8);

  return {
    nick: opts.nick,
    kit: opts.kit || null,
    marketValue: market,
    grindBroughtBd: grind,
    estimate: Math.max(0, Math.round(opts.estimate || 0)),
    mainCwWins: bonus.mainWins,
    juniorCwWins: bonus.juniorWins,
    cwBonus: bonus.cwBonus,
    foundingBonus: founding,
    total,
    series,
    events: recentEvents,
  };
}
