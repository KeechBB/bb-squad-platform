import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isBuiltinSuperAdmin } from "@/lib/admin";
import { ESTIMATE_BASE } from "@/lib/blueberryDollar";
import { expireDueContracts } from "@/lib/factionHr";
import {
  isBlackberryClan,
  loadFactionView,
  mainKits,
} from "@/lib/factions";
import { factionUiColor } from "@/lib/factionColors";
import {
  estimateWithKit,
  loadPlayerPriceStats,
  normalizeKit,
} from "@/lib/factionTransfers";
import { prisma } from "@/lib/prisma";
import { personLabel } from "@/lib/actionLog";

type Ctx = { params: Promise<{ slug: string }> };

function mskDayKey(d: Date): string {
  const t = new Date(d.getTime() + 3 * 60 * 60 * 1000);
  const y = t.getUTCFullYear();
  const m = String(t.getUTCMonth() + 1).padStart(2, "0");
  const day = String(t.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

type MemberLite = {
  userId: string;
  nick: string;
  joinedAt: Date;
  factionId: string;
  factionName: string;
  factionSlug: string;
  factionColor: string;
};

async function loadAllBbMembers(): Promise<MemberLite[]> {
  const factions = await prisma.faction.findMany({
    where: { clan: { tag: "BB", isExternal: false } },
    select: {
      id: true,
      name: true,
      slug: true,
      clan: { select: { tag: true, isExternal: true } },
      members: {
        select: {
          userId: true,
          joinedAt: true,
          user: {
            select: {
              nick: true,
              name: true,
              steamName: true,
              steamId: true,
            },
          },
        },
        orderBy: { joinedAt: "asc" },
      },
    },
    orderBy: { name: "asc" },
  });
  const out: MemberLite[] = [];
  for (const f of factions) {
    if (!isBlackberryClan(f.clan)) continue;
    const color = factionUiColor(f.name, f.slug);
    for (const m of f.members) {
      if (isBuiltinSuperAdmin(m.user.steamId)) continue;
      out.push({
        userId: m.userId,
        nick: personLabel(m.user),
        joinedAt: m.joinedAt,
        factionId: f.id,
        factionName: f.name,
        factionSlug: f.slug,
        factionColor: color,
      });
    }
  }
  return out;
}

async function buildRows(members: MemberLite[]) {
  const userIds = members.map((m) => m.userId);
  if (!userIds.length) return [];

  const byFaction = new Map<string, MemberLite[]>();
  for (const m of members) {
    const list = byFaction.get(m.factionId) || [];
    list.push(m);
    byFaction.set(m.factionId, list);
  }

  const [kits, priceStats, salaries, contracts] = await Promise.all([
    mainKits(userIds),
    loadPlayerPriceStats(userIds),
    prisma.factionPlayerSalary.findMany({
      where: { userId: { in: userIds } },
    }),
    prisma.factionPlayerContract.findMany({
      where: {
        userId: { in: userIds },
        status: "ACTIVE",
        endsAt: { gt: new Date() },
      },
    }),
  ]);

  const salaryBy = new Map(
    salaries.map((s) => [`${s.factionId}:${s.userId}`, s.pct] as const),
  );
  const contractBy = new Set(
    contracts.map((c) => `${c.factionId}:${c.userId}`),
  );

  const kitCountsByFaction = new Map<string, Map<string, number>>();
  for (const [factionId, list] of byFaction) {
    const counts = new Map<string, number>();
    for (const m of list) {
      const k = normalizeKit(kits.get(m.userId) || null);
      counts.set(k, (counts.get(k) || 0) + 1);
    }
    kitCountsByFaction.set(factionId, counts);
  }

  const now = Date.now();
  const rows = members.map((m) => {
    const st = priceStats.get(m.userId);
    const grindBroughtBd = Math.max(0, Math.round(st?.grindBroughtBd || 0));
    const mainKit = kits.get(m.userId) || "—";
    const kitKey = normalizeKit(mainKit);
    const rosterSize = byFaction.get(m.factionId)?.length || 1;
    const kitCount = kitCountsByFaction.get(m.factionId)?.get(kitKey) || 0;
    let scarcity: "critical" | "thin" | "ok" | "surplus" = "ok";
    if (rosterSize < 8) scarcity = kitCount <= 1 ? "critical" : "ok";
    else {
      const share = kitCount / Math.max(1, rosterSize);
      if (kitCount <= 1 || share < 0.04) scarcity = "critical";
      else if (kitCount <= 2 || share < 0.08) scarcity = "thin";
      else if (share > 0.28) scarcity = "surplus";
    }
    const playerValue = estimateWithKit(
      st || {
        trainDays14: 0,
        matches30: 0,
        kills30: 0,
        deaths30: 0,
        res30: 0,
        nok30: 0,
        lastSeenDaysAgo: null,
        grindBroughtBd,
      },
      mainKit,
      scarcity,
    );
    const joinedMs = m.joinedAt.getTime();
    const daysIn = Math.max(
      1,
      Math.ceil(
        (now - (Number.isFinite(joinedMs) ? joinedMs : now)) / 86_400_000,
      ),
    );
    const key = `${m.factionId}:${m.userId}`;
    return {
      order: 0,
      userId: m.userId,
      nick: m.nick,
      joinedAt: m.joinedAt.toISOString(),
      playerValue,
      base: ESTIMATE_BASE,
      grindBroughtBd,
      avgPerDay: Math.round(grindBroughtBd / daysIn),
      daysInFaction: daysIn,
      hasContract: contractBy.has(key),
      salaryPct: salaryBy.get(key) ?? 0,
      factionId: m.factionId,
      factionName: m.factionName,
      factionSlug: m.factionSlug,
      factionColor: m.factionColor,
    };
  });

  rows.sort(
    (a, b) =>
      b.playerValue - a.playerValue ||
      a.nick.localeCompare(b.nick, "ru") ||
      a.userId.localeCompare(b.userId),
  );
  return rows.map((r, i) => ({ ...r, order: i + 1 }));
}

export async function GET(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const session = await getServerSession(authOptions);
  const loaded = await loadFactionView(
    decodeURIComponent(slug),
    session?.user?.steamId ?? null,
  );
  if (loaded.error || !loaded.view) {
    return NextResponse.json({ error: "notfound" }, { status: 404 });
  }
  if (!loaded.view.keech && !loaded.view.mySeat) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  await expireDueContracts();
  const url = new URL(req.url);
  const all = url.searchParams.get("all") === "1";
  const detailUserId = String(url.searchParams.get("userId") || "").trim();

  const members: MemberLite[] = all
    ? await loadAllBbMembers()
    : loaded.view.members.map((m) => ({
        userId: m.userId,
        nick: m.nick,
        joinedAt: new Date(m.joinedAt),
        factionId: loaded.view!.id,
        factionName: loaded.view!.name,
        factionSlug: loaded.view!.slug,
        factionColor: factionUiColor(loaded.view!.name, loaded.view!.slug),
      }));

  if (detailUserId) {
    const member = members.find((m) => m.userId === detailUserId);
    if (!member) {
      return NextResponse.json({ error: "not_member" }, { status: 400 });
    }
    const entries = await prisma.factionLedgerEntry.findMany({
      where: {
        factionId: member.factionId,
        userId: detailUserId,
        kind: "grind",
        amount: { gt: 0 },
      },
      select: { amount: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 2000,
    });
    const byDay = new Map<string, number>();
    for (const e of entries) {
      const key = mskDayKey(e.createdAt);
      byDay.set(key, (byDay.get(key) || 0) + Math.max(0, e.amount));
    }
    const days = [...byDay.entries()]
      .map(([day, amount]) => ({ day, amount }))
      .sort((a, b) => b.day.localeCompare(a.day));
    const rows = await buildRows([member]);
    const row = rows[0];
    return NextResponse.json({
      userId: detailUserId,
      nick: member.nick,
      base: ESTIMATE_BASE,
      grindBroughtBd: row?.grindBroughtBd ?? 0,
      playerValue: row?.playerValue ?? ESTIMATE_BASE,
      factionName: member.factionName,
      factionColor: member.factionColor,
      days,
    });
  }

  const rows = await buildRows(members);
  const factions = [
    ...new Map(
      members.map((m) => [
        m.factionId,
        {
          id: m.factionId,
          name: m.factionName,
          slug: m.factionSlug,
          color: m.factionColor,
        },
      ]),
    ).values(),
  ].sort((a, b) => a.name.localeCompare(b.name, "ru"));

  return NextResponse.json({
    base: ESTIMATE_BASE,
    formula: "20000 + гринд",
    scope: all ? "all" : "faction",
    factions,
    rows,
  });
}
