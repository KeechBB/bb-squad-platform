import { prisma } from "@/lib/prisma";
import { loadKvJsonCached } from "@/lib/kvLocal";
import { loadTierIndex } from "@/lib/loadTierIndex";
import { ensureDefaultSquads } from "@/lib/squads";

export type BbStackName = "Main" | "Junior";

/** Командование составов BlackBerry (оба — клан BB, общий руководитель Keech). */
export const BB_STACK_COMMAND = {
  overallLead: "Keech",
  Main: { lead: "Keech", assistant: "Chidori" },
  Junior: { lead: "Jimmy Neutron", assistant: "VET" },
} as const;

/** Ники, всегда закреплённые за составом (алиасы → канон). */
const FORCE_STACK: Record<string, BbStackName> = {
  keech: "Main",
  chidori: "Main",
  "jimmy neutron": "Junior",
  jimmy: "Junior",
  jimmyneutron: "Junior",
  vet: "Junior",
};

const ENSURE_NICKS = ["Keech", "Chidori", "Jimmy Neutron", "VET"] as const;

type MonthIndex = { months?: Array<{ url?: string }> };
type MonthFile = {
  matches?: Array<{
    id?: string;
    status?: string;
    stack?: string;
    playersUrl?: string;
  }>;
};
type PlayersFile = {
  total?: Array<{ nick?: string }>;
  players?: Array<{ nick?: string }>;
  r1?: Array<{ nick?: string }>;
  r2?: Array<{ nick?: string }>;
};

export type StackFreqRow = {
  nick: string;
  main: number;
  junior: number;
  total: number;
  tier: number;
  prefer: BbStackName;
  stack: BbStackName;
};

function nickKey(nick: string): string {
  return nick.trim().toLowerCase().replace(/\s+/g, " ");
}

function nickCompact(nick: string): string {
  return nick.trim().toLowerCase().replace(/\s+/g, "");
}

function forceOf(nick: string): BbStackName | undefined {
  return FORCE_STACK[nickKey(nick)] || FORCE_STACK[nickCompact(nick)];
}

function collectNicks(pj: PlayersFile): string[] {
  const nicks = new Set<string>();
  for (const key of ["total", "players", "r1", "r2"] as const) {
    for (const p of pj[key] || []) {
      const n = String(p?.nick || "").trim();
      if (n) nicks.add(n);
    }
  }
  return [...nicks];
}

function resolveStack(
  prefer: BbStackName,
  tier: number,
  forced?: BbStackName
): BbStackName {
  if (forced) return forced;
  // Main только Тир 1 / Тир 2
  if (prefer === "Main" && tier !== 1 && tier !== 2) return "Junior";
  return prefer;
}

/** Считаем Main/Junior по всем сыгранным КВ со статой. */
export async function computeBbStackFrequency(): Promise<StackFreqRow[]> {
  const idx = await loadKvJsonCached<MonthIndex>("data/index.json");
  if (!idx?.months?.length) return [];

  const tierMap = await loadTierIndex();
  const counts = new Map<string, { nick: string; main: number; junior: number }>();
  const last = new Map<string, BbStackName>();

  for (const meta of idx.months) {
    const url = String(meta.url || "").replace(/^\/+/, "");
    if (!url) continue;
    const month = await loadKvJsonCached<MonthFile>(url);
    for (const m of month?.matches || []) {
      const st = String(m.status || "").toLowerCase();
      const stack = String(m.stack || "").trim() as BbStackName;
      if (stack !== "Main" && stack !== "Junior") continue;
      if (st !== "win" && st !== "lose") continue;
      const purl = String(m.playersUrl || "").replace(/^\/+/, "");
      if (!purl) continue;
      const pj = await loadKvJsonCached<PlayersFile>(purl);
      if (!pj) continue;
      for (const nick of collectNicks(pj)) {
        const key = nickKey(nick);
        const row = counts.get(key) || { nick, main: 0, junior: 0 };
        if (!row.nick) row.nick = nick;
        if (stack === "Main") row.main += 1;
        else row.junior += 1;
        counts.set(key, row);
        last.set(key, stack);
      }
    }
  }

  const rows: StackFreqRow[] = [];
  for (const [key, c] of counts) {
    const forced = forceOf(c.nick);
    let prefer: BbStackName;
    if (c.main > c.junior) prefer = "Main";
    else if (c.junior > c.main) prefer = "Junior";
    else prefer = last.get(key) || "Main";
    const tier = tierMap.get(nickCompact(c.nick)) ?? 4;
    rows.push({
      nick: c.nick,
      main: c.main,
      junior: c.junior,
      total: c.main + c.junior,
      tier,
      prefer,
      stack: resolveStack(prefer, tier, forced),
    });
  }

  for (const canon of ENSURE_NICKS) {
    if (rows.some((r) => nickKey(r.nick) === nickKey(canon))) continue;
    const forced = forceOf(canon) || "Junior";
    const tier = tierMap.get(nickCompact(canon)) ?? 4;
    rows.push({
      nick: canon,
      main: 0,
      junior: 0,
      total: 0,
      tier,
      prefer: forced,
      stack: forced,
    });
  }

  rows.sort(
    (a, b) =>
      a.stack.localeCompare(b.stack) ||
      b.total - a.total ||
      a.nick.localeCompare(b.nick, "ru")
  );
  return rows;
}

function isBbClan(tag: string, name: string): boolean {
  const t = tag.trim().toLowerCase();
  const n = name.trim().toLowerCase();
  return t === "bb" || n === "blackberry";
}

/**
 * Пересобрать Main/Junior BB по частоте КВ.
 * Main = чаще Main и Тир 1/2. Иначе Junior.
 * Зарегистрированные с КВ-статой / лиды докидываются в ClanMember BB.
 */
export async function syncBbSquadsFromKv(): Promise<{
  ok: boolean;
  main: string[];
  junior: string[];
  skipped: number;
  message: string;
}> {
  const clan = await prisma.clan.findFirst({
    where: {
      OR: [
        { tag: { equals: "BB", mode: "insensitive" } },
        { name: { equals: "BlackBerry", mode: "insensitive" } },
      ],
    },
    select: { id: true, tag: true, name: true },
  });
  if (!clan || !isBbClan(clan.tag, clan.name)) {
    return {
      ok: false,
      main: [],
      junior: [],
      skipped: 0,
      message: "Клан BlackBerry не найден",
    };
  }

  await ensureDefaultSquads(clan.id);

  const squads = await prisma.clanSquad.findMany({
    where: { clanId: clan.id },
    select: { id: true, name: true },
  });
  const mainSquad = squads.find((s) => s.name.toLowerCase() === "main");
  const juniorSquad = squads.find((s) => s.name.toLowerCase() === "junior");
  if (!mainSquad || !juniorSquad) {
    return {
      ok: false,
      main: [],
      junior: [],
      skipped: 0,
      message: "Нет составов Main/Junior",
    };
  }

  const freq = await computeBbStackFrequency();
  const byKey = new Map(freq.map((r) => [nickKey(r.nick), r]));
  const byCompact = new Map(freq.map((r) => [nickCompact(r.nick), r]));

  const users = await prisma.user.findMany({
    where: { OR: [{ nick: { not: null } }, { steamName: { not: null } }] },
    select: { id: true, nick: true, steamName: true },
  });

  // Докинуть в клан: лиды + все с КВ-статой
  const ensureIds: string[] = [];
  for (const u of users) {
    const label = (u.nick || u.steamName || "").trim();
    if (!label) continue;
    const hit = byKey.get(nickKey(label)) || byCompact.get(nickCompact(label));
    const forced = forceOf(label);
    if (!hit && !forced) continue;
    if (hit && hit.total <= 0 && !forced) continue;
    ensureIds.push(u.id);
  }
  if (ensureIds.length) {
    await prisma.clanMember.createMany({
      data: ensureIds.map((userId) => ({
        clanId: clan.id,
        userId,
        role: "MEMBER" as const,
      })),
      skipDuplicates: true,
    });
  }

  const members = await prisma.clanMember.findMany({
    where: { clanId: clan.id },
    select: {
      userId: true,
      user: { select: { nick: true, steamName: true } },
    },
  });

  const mainIds: string[] = [];
  const juniorIds: string[] = [];
  const mainNicks: string[] = [];
  const juniorNicks: string[] = [];
  let skipped = 0;

  for (const m of members) {
    const nick = (m.user.nick || m.user.steamName || "").trim();
    if (!nick) {
      skipped += 1;
      continue;
    }
    const hit = byKey.get(nickKey(nick)) || byCompact.get(nickCompact(nick));
    const forced = forceOf(nick);
    if (!hit && !forced) {
      skipped += 1;
      continue;
    }
    if ((!hit || hit.total <= 0) && !forced) {
      skipped += 1;
      continue;
    }
    const stack = hit?.stack || forced!;
    if (stack === "Main") {
      mainIds.push(m.userId);
      mainNicks.push(nick);
    } else {
      juniorIds.push(m.userId);
      juniorNicks.push(nick);
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.clanSquadMember.deleteMany({
      where: { squadId: { in: [mainSquad.id, juniorSquad.id] } },
    });
    if (mainIds.length) {
      await tx.clanSquadMember.createMany({
        data: mainIds.map((userId) => ({ squadId: mainSquad.id, userId })),
        skipDuplicates: true,
      });
    }
    if (juniorIds.length) {
      await tx.clanSquadMember.createMany({
        data: juniorIds.map((userId) => ({ squadId: juniorSquad.id, userId })),
        skipDuplicates: true,
      });
    }
    const extras = squads.filter(
      (s) => !["main", "junior"].includes(s.name.toLowerCase())
    );
    if (extras.length) {
      await tx.clanSquad.deleteMany({
        where: { id: { in: extras.map((s) => s.id) } },
      });
    }
  });

  mainNicks.sort((a, b) => a.localeCompare(b, "ru"));
  juniorNicks.sort((a, b) => a.localeCompare(b, "ru"));

  return {
    ok: true,
    main: mainNicks,
    junior: juniorNicks,
    skipped,
    message: `Main ${mainNicks.length} · Junior ${juniorNicks.length}`,
  };
}
