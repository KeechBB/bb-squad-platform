import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ensureBbDefaultSquads, ensureDefaultSquads } from "@/lib/squads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "no-store",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

/** Публичная карта ник → клан/состав для рейтинга КВ */
export async function GET() {
  await ensureBbDefaultSquads();

  const clans = await prisma.clan.findMany({ select: { id: true } });
  await Promise.all(clans.map((c) => ensureDefaultSquads(c.id)));

  const refreshed = await prisma.clan.findMany({
    select: {
      name: true,
      tag: true,
      squads: {
        orderBy: { sortOrder: "asc" },
        select: {
          name: true,
          members: {
            select: { user: { select: { nick: true } } },
          },
        },
      },
      members: {
        select: { user: { select: { nick: true } } },
      },
    },
  });

  const byNick: Record<
    string,
    { clan: string; tag: string; squad: string | null }
  > = {};

  for (const clan of refreshed) {
    const nickInSquad = new Set<string>();
    for (const squad of clan.squads) {
      for (const m of squad.members) {
        const nick = (m.user.nick || "").trim();
        if (!nick) continue;
        const key = nick.toLowerCase();
        byNick[key] = { clan: clan.name, tag: clan.tag, squad: squad.name };
        nickInSquad.add(key);
      }
    }
    for (const m of clan.members) {
      const nick = (m.user.nick || "").trim();
      if (!nick) continue;
      const key = nick.toLowerCase();
      if (nickInSquad.has(key) || byNick[key]) continue;
      byNick[key] = { clan: clan.name, tag: clan.tag, squad: null };
    }
  }

  return NextResponse.json(
    { byNick, updatedAt: new Date().toISOString() },
    { headers: CORS }
  );
}
