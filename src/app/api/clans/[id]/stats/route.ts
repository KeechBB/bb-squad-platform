import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { buildClanKvStats } from "@/lib/kvStats";
import { hitmapAverageForClan } from "@/lib/squadHits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const HOLDER_STEAM = "76561199000000001";
const EXTERNAL_LEADER_STEAM_PREFIX = "7656119900001";

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const clan = await prisma.clan.findUnique({
    where: { id },
    select: {
      tag: true,
      name: true,
      isExternal: true,
      members: {
        select: {
          user: { select: { id: true, steamId: true, nick: true } },
        },
      },
      pendingMembers: {
        select: { steamId: true },
      },
    },
  });
  if (!clan) {
    return NextResponse.json({ error: "Клан не найден" }, { status: 404 });
  }

  try {
    const stats = await buildClanKvStats(clan.tag);

    const userIds: string[] = [];
    const steamIds: string[] = [];
    for (const m of clan.members) {
      const steam = m.user.steamId || "";
      if (
        steam.startsWith(EXTERNAL_LEADER_STEAM_PREFIX) ||
        steam === HOLDER_STEAM
      ) {
        continue;
      }
      userIds.push(m.user.id);
      if (steam) steamIds.push(steam);
    }
    for (const p of clan.pendingMembers || []) {
      if (p.steamId) steamIds.push(p.steamId);
    }

    const hitmap = await hitmapAverageForClan({ userIds, steamIds });

    return NextResponse.json({
      ok: true,
      clan: { tag: clan.tag, name: clan.name },
      stats: {
        ...stats,
        hitmap:
          hitmap.players > 0
            ? {
                players: hitmap.players,
                totalHits: hitmap.totalHits,
                bonePct: hitmap.bonePct,
                bones: hitmap.bones,
              }
            : null,
      },
    });
  } catch (e) {
    return NextResponse.json(
      {
        error: "Не удалось загрузить КВ",
        detail: e instanceof Error ? e.message : String(e),
      },
      { status: 502 }
    );
  }
}
