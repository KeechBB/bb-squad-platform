import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { warmClanPublicStats } from "@/lib/clanPublicStatsCache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Прогрев кеша статистики кланов (PB1) — без auth, cron / post-deploy. */
export async function GET(req: Request) {
  const t0 = Date.now();
  const url = new URL(req.url);
  const onlyTag = (url.searchParams.get("tag") || "").trim();

  const clans = await prisma.clan.findMany({
    where: {
      isExternal: false,
      ...(onlyTag ? { tag: { equals: onlyTag, mode: "insensitive" } } : {}),
    },
    select: { id: true, tag: true, name: true },
    orderBy: { name: "asc" },
  });

  const results: {
    tag: string;
    playersWithCombat: number;
    membersTotal: number;
    ms: number;
  }[] = [];

  for (const c of clans) {
    const t1 = Date.now();
    const snap = await warmClanPublicStats(c.id, c.tag);
    results.push({
      tag: c.tag,
      playersWithCombat: snap.public.playersWithCombat,
      membersTotal: snap.public.membersTotal,
      ms: Date.now() - t1,
    });
  }

  return NextResponse.json({
    ok: true,
    clans: results.length,
    results,
    ms: Date.now() - t0,
  });
}
