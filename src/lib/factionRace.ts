import { prisma } from "@/lib/prisma";
import { factionUiColor } from "@/lib/factionColors";
import { parseFactionInfo } from "@/lib/factionInfoDoc";
import { estimatePlayerPrice } from "@/lib/blueberryDollar";
import {
  RACE_BASE_GOAL,
  RACE_EPOCH_START,
  formatRaceWindowLabel,
  raceProgressLedgerWhere,
  raceWindowAt,
  raceWindowByIndex,
} from "@/lib/factionRaceCanon";
import {
  eligibleForceCandidates,
  listRacingFactions,
  tickFactionRace,
} from "@/lib/factionRaceEngine";

export type FactionRaceRow = {
  factionId: string;
  name: string;
  slug: string;
  color: string;
  font: string;
  amount: number;
  goal: number;
  pct: number;
  status: string;
  graceEndsAt: string | null;
  met: boolean | null;
};

export type FactionRacePenaltyCandidate = {
  userId: string;
  nick: string;
  playerValue: number;
  grindBroughtBd: number;
};

export type FactionRacePenalty = {
  active: boolean;
  resultId: string;
  windowId: string;
  graceEndsAt: string | null;
  amount: number;
  goal: number;
  candidates: FactionRacePenaltyCandidate[];
};

export type FactionRaceWeekFaction = {
  factionId: string;
  name: string;
  slug: string;
  color: string;
  amount: number;
  goal: number;
  pct: number;
  met: boolean;
  status: string;
  isWinner: boolean;
};

export type FactionRaceWeek = {
  windowId: string;
  label: string;
  startIso: string;
  endIso: string;
  winnerName: string | null;
  winnerAmount: number;
  winnerGoal: number;
  rows: FactionRaceWeekFaction[];
};

export type FactionRaceBoard = {
  label: string;
  startIso: string;
  endIso: string;
  epochIso: string;
  windowEnded: boolean;
  windowId: string;
  rows: FactionRaceRow[];
  penalty: FactionRacePenalty | null;
  weeks: FactionRaceWeek[];
};

export async function factionRaceBoard(clanId: string): Promise<FactionRaceBoard> {
  // Тихий тик — письма/финалы/grace (идемпотентно)
  void tickFactionRace().catch((e) => console.error("faction race tick", e));

  const now = new Date();
  let bounds = raceWindowAt(now);
  if (!bounds) {
    // До старта эпохи — показываем первое окно
    bounds = raceWindowByIndex(0);
  }

  const racing = (await listRacingFactions()).filter((f) => {
    // listRacing уже без Легиона; на всякий случай сверим clan
    return true;
  });
  // Если вызвали с clanId — отфильтруем
  const factions = racing.length
    ? racing
    : await prisma.faction.findMany({
        where: { clanId },
        select: { id: true, name: true, slug: true, clanId: true },
      });

  const ids = factions.map((f) => f.id);
  const [grind, states, results] = await Promise.all([
    ids.length === 0
      ? Promise.resolve([])
      : prisma.factionLedgerEntry.groupBy({
          by: ["factionId"],
          where: raceProgressLedgerWhere({ in: ids }, bounds.start, bounds.end),
          _sum: { amount: true },
        }),
    ids.length === 0
      ? Promise.resolve([])
      : prisma.factionRaceState.findMany({ where: { factionId: { in: ids } } }),
    ids.length === 0
      ? Promise.resolve([])
      : prisma.factionRaceResult.findMany({
          where: { windowId: bounds.id, factionId: { in: ids } },
        }),
  ]);

  const amountBy = new Map(grind.map((g) => [g.factionId, Math.max(0, g._sum.amount || 0)]));
  const goalBy = new Map(states.map((s) => [s.factionId, s.goal]));
  const resultBy = new Map(results.map((r) => [r.factionId, r]));

  const infos = await prisma.faction.findMany({
    where: { id: { in: ids } },
    select: { id: true, info: true },
  });
  const infoBy = new Map(infos.map((f) => [f.id, f.info]));

  const rows: FactionRaceRow[] = factions.map((f) => {
    const amount = amountBy.get(f.id) || 0;
    const res = resultBy.get(f.id);
    const goal = res?.goal || goalBy.get(f.id) || RACE_BASE_GOAL;
    const pct = goal > 0 ? Math.min(100, Math.round((amount / goal) * 1000) / 10) : 0;
    const info = parseFactionInfo(infoBy.get(f.id));
    return {
      factionId: f.id,
      name: f.name,
      slug: f.slug,
      color: factionUiColor(f.name, f.slug, info.color),
      font: info.font || "Oxanium",
      amount,
      goal,
      pct,
      status: res?.status || "open",
      graceEndsAt: res?.graceEndsAt ? res.graceEndsAt.toISOString() : null,
      met: res ? res.met : null,
    };
  });

  rows.sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name, "ru"));

  const windowEnded = now >= bounds.end;
  const weeks = await factionRaceWeekHistory({ take: 24 });

  return {
    label: `${formatRaceWindowLabel(bounds.start, bounds.end)} · личные цели`,
    startIso: bounds.start.toISOString(),
    endIso: bounds.end.toISOString(),
    epochIso: RACE_EPOCH_START.toISOString(),
    windowEnded,
    windowId: bounds.id,
    rows,
    penalty: null,
    weeks,
  };
}

export async function loadRacePenaltyForFaction(
  factionId: string,
): Promise<FactionRacePenalty | null> {
  const row = await prisma.factionRaceResult.findFirst({
    where: {
      factionId,
      status: "grace",
      graceEndsAt: { gt: new Date() },
    },
  });
  if (!row) return null;

  const cands = await eligibleForceCandidates(factionId, row.protectedReserveIds);
  const userIds = cands.map((c) => c.userId);
  const grind = userIds.length
    ? await prisma.factionLedgerEntry.groupBy({
        by: ["userId"],
        where: { userId: { in: userIds }, kind: "grind", amount: { gt: 0 } },
        _sum: { amount: true },
      })
    : [];
  const grindBy = new Map(
    grind.map((g) => [g.userId!, Math.max(0, Math.round(g._sum.amount || 0))]),
  );

  const candidates: FactionRacePenaltyCandidate[] = cands
    .map((c) => {
      const grindBroughtBd = grindBy.get(c.userId) || 0;
      return {
        userId: c.userId,
        nick: c.nick,
        grindBroughtBd,
        playerValue: estimatePlayerPrice({ grindBroughtBd }),
      };
    })
    .sort(
      (a, b) =>
        b.playerValue - a.playerValue || a.nick.localeCompare(b.nick, "ru"),
    );

  return {
    active: true,
    resultId: row.id,
    windowId: row.windowId,
    graceEndsAt: row.graceEndsAt ? row.graceEndsAt.toISOString() : null,
    amount: row.amount,
    goal: row.goal,
    candidates,
  };
}

export async function factionRaceWeekHistory(opts?: {
  take?: number;
}): Promise<FactionRaceWeek[]> {
  const take = Math.min(52, Math.max(1, opts?.take ?? 24));
  const windows = await prisma.factionRaceWindow.findMany({
    orderBy: { id: "desc" },
    take,
  });
  if (!windows.length) return [];

  const results = await prisma.factionRaceResult.findMany({
    where: {
      windowId: { in: windows.map((w) => w.id) },
      status: { not: "open" },
    },
    include: {
      faction: { select: { id: true, name: true, slug: true, info: true } },
    },
  });

  const byWin = new Map<string, typeof results>();
  for (const r of results) {
    const list = byWin.get(r.windowId) || [];
    list.push(r);
    byWin.set(r.windowId, list);
  }

  const out: FactionRaceWeek[] = [];
  for (const w of windows) {
    const list = byWin.get(w.id) || [];
    if (!list.length) continue;
    let leaderAmount = 0;
    for (const r of list) leaderAmount = Math.max(leaderAmount, r.amount);
    const rows: FactionRaceWeekFaction[] = list
      .map((r) => {
        const info = parseFactionInfo(r.faction.info);
        const pct =
          r.goal > 0
            ? Math.min(100, Math.round((r.amount / r.goal) * 1000) / 10)
            : 0;
        return {
          factionId: r.factionId,
          name: r.faction.name,
          slug: r.faction.slug,
          color: factionUiColor(r.faction.name, r.faction.slug, info.color),
          amount: r.amount,
          goal: r.goal,
          pct,
          met: r.met,
          status: r.status,
          isWinner: leaderAmount > 0 && r.amount === leaderAmount,
        };
      })
      .sort(
        (a, b) =>
          b.amount - a.amount || a.name.localeCompare(b.name, "ru"),
      );
    const winner = rows.find((r) => r.isWinner) || null;
    out.push({
      windowId: w.id,
      label: formatRaceWindowLabel(w.startAt, w.endAt),
      startIso: w.startAt.toISOString(),
      endIso: w.endAt.toISOString(),
      winnerName: winner?.name || null,
      winnerAmount: winner?.amount || 0,
      winnerGoal: winner?.goal || 0,
      rows,
    });
  }
  return out;
}
