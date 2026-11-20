import { prisma } from "@/lib/prisma";
import { factionUiColor } from "@/lib/factionColors";
import { parseFactionInfo } from "@/lib/factionInfoDoc";

/** Гонка фракций: окно 21.11 00:00 → 28.11 00:00 МСК, цель 400 000 B$. */
export const FACTION_RACE_GOAL = 400_000;

/** 21.11.2026 00:00 МСК */
export const FACTION_RACE_START = new Date("2026-11-20T21:00:00.000Z");
/** 28.11.2026 00:00 МСК */
export const FACTION_RACE_END = new Date("2026-11-27T21:00:00.000Z");

export const FACTION_RACE_LABEL =
  "21.11 00:00 — 28.11 00:00 МСК · цель 400 000 B$";

/** Легион вне гонки (политика принуд. трансферов на него не распространяется). */
function isRaceExcluded(name: string, slug: string): boolean {
  const key = `${name} ${slug}`
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[\s_-]+/g, "");
  return key.includes("легион");
}

export type FactionRaceRow = {
  factionId: string;
  name: string;
  slug: string;
  color: string;
  font: string;
  amount: number;
  goal: number;
  pct: number;
};

export type FactionRaceBoard = {
  label: string;
  startIso: string;
  endIso: string;
  goal: number;
  rows: FactionRaceRow[];
};

export async function factionRaceBoard(clanId: string): Promise<FactionRaceBoard> {
  const factions = await prisma.faction.findMany({
    where: { clanId },
    select: { id: true, name: true, slug: true, info: true },
    orderBy: { name: "asc" },
  });

  const racing = factions.filter((f) => !isRaceExcluded(f.name, f.slug));
  const ids = racing.map((f) => f.id);

  const grind =
    ids.length === 0
      ? []
      : await prisma.factionLedgerEntry.groupBy({
          by: ["factionId"],
          where: {
            factionId: { in: ids },
            kind: "grind",
            amount: { gt: 0 },
            createdAt: { gte: FACTION_RACE_START, lt: FACTION_RACE_END },
          },
          _sum: { amount: true },
        });

  const byId = new Map(grind.map((g) => [g.factionId, Math.max(0, g._sum.amount || 0)]));

  const rows: FactionRaceRow[] = racing.map((f) => {
    const amount = byId.get(f.id) || 0;
    const info = parseFactionInfo(f.info);
    const pct = Math.min(100, Math.round((amount / FACTION_RACE_GOAL) * 1000) / 10);
    return {
      factionId: f.id,
      name: f.name,
      slug: f.slug,
      color: factionUiColor(f.name, f.slug, info.color),
      font: info.font || "Oxanium",
      amount,
      goal: FACTION_RACE_GOAL,
      pct,
    };
  });

  rows.sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name, "ru"));

  return {
    label: FACTION_RACE_LABEL,
    startIso: FACTION_RACE_START.toISOString(),
    endIso: FACTION_RACE_END.toISOString(),
    goal: FACTION_RACE_GOAL,
    rows,
  };
}
