import { prisma } from "@/lib/prisma";
import { factionUiColor } from "@/lib/factionColors";
import { parseFactionInfo } from "@/lib/factionInfoDoc";
import {
  RACE_BASE_GOAL,
  RACE_EPOCH_START,
  formatRaceWindowLabel,
  raceProgressLedgerWhere,
  raceWindowAt,
  raceWindowByIndex,
} from "@/lib/factionRaceCanon";
import { listRacingFactions, tickFactionRace } from "@/lib/factionRaceEngine";

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

export type FactionRaceBoard = {
  label: string;
  startIso: string;
  endIso: string;
  epochIso: string;
  rows: FactionRaceRow[];
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

  return {
    label: `${formatRaceWindowLabel(bounds.start, bounds.end)} · личные цели`,
    startIso: bounds.start.toISOString(),
    endIso: bounds.end.toISOString(),
    epochIso: RACE_EPOCH_START.toISOString(),
    rows,
  };
}
