import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { loadFactionView } from "@/lib/factions";
import { ESTIMATE_BASE } from "@/lib/blueberryDollar";
import { expireDueContracts } from "@/lib/factionHr";
import { prisma } from "@/lib/prisma";

type Ctx = { params: Promise<{ slug: string }> };

function mskDayKey(d: Date): string {
  // YYYY-MM-DD по МСК (UTC+3)
  const t = new Date(d.getTime() + 3 * 60 * 60 * 1000);
  const y = t.getUTCFullYear();
  const m = String(t.getUTCMonth() + 1).padStart(2, "0");
  const day = String(t.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
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
  const factionId = loaded.view.id;
  const members = loaded.view.members;
  const userIds = members.map((m) => m.userId);
  const url = new URL(req.url);
  const detailUserId = String(url.searchParams.get("userId") || "").trim();

  if (detailUserId) {
    if (!userIds.includes(detailUserId)) {
      return NextResponse.json({ error: "not_member" }, { status: 400 });
    }
    const entries = await prisma.factionLedgerEntry.findMany({
      where: {
        factionId,
        userId: detailUserId,
        kind: "grind",
        amount: { gt: 0 },
      },
      select: { amount: true, createdAt: true, note: true, matchId: true },
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
    const member = members.find((m) => m.userId === detailUserId)!;
    return NextResponse.json({
      userId: detailUserId,
      nick: member.nick,
      base: ESTIMATE_BASE,
      grindBroughtBd: member.grindBroughtBd,
      playerValue: member.playerValue,
      days,
    });
  }

  const [salaries, contracts] = await Promise.all([
    prisma.factionPlayerSalary.findMany({
      where: { factionId, userId: { in: userIds } },
    }),
    prisma.factionPlayerContract.findMany({
      where: {
        factionId,
        userId: { in: userIds },
        status: "ACTIVE",
        endsAt: { gt: new Date() },
      },
    }),
  ]);
  const salaryBy = Object.fromEntries(salaries.map((s) => [s.userId, s.pct]));
  const contractBy = new Set(contracts.map((c) => c.userId));

  const now = Date.now();
  const rows = members.map((m) => {
    const joinedMs = new Date(m.joinedAt).getTime();
    const daysIn = Math.max(
      1,
      Math.ceil((now - (Number.isFinite(joinedMs) ? joinedMs : now)) / 86_400_000),
    );
    const avgPerDay = Math.round(m.grindBroughtBd / daysIn);
    return {
      order: m.order,
      userId: m.userId,
      nick: m.nick,
      joinedAt: m.joinedAt,
      playerValue: m.playerValue,
      base: ESTIMATE_BASE,
      grindBroughtBd: m.grindBroughtBd,
      avgPerDay,
      daysInFaction: daysIn,
      hasContract: contractBy.has(m.userId),
      salaryPct: salaryBy[m.userId] ?? 0,
    };
  });

  return NextResponse.json({
    base: ESTIMATE_BASE,
    formula: "20000 + гринд",
    rows,
  });
}
