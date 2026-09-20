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

function nickKey(nick: string): string {
  return nick.trim().toLowerCase().replace(/\s+/g, " ");
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

/** Публичная карта ник → клан/состав/номер регистрации для рейтинга КВ */
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

  const registered = await prisma.user.findMany({
    where: { profileComplete: true, nick: { not: null } },
    orderBy: [{ regNo: "asc" }, { createdAt: "asc" }],
    select: { nick: true, steamId: true, createdAt: true, regNo: true },
  });

  const regByNick = new Map<string, number>();
  registered.forEach((u) => {
    const nick = (u.nick || "").trim();
    if (!nick || u.regNo == null) return;
    regByNick.set(nickKey(nick), u.regNo);
  });

  const byNick: Record<
    string,
    {
      clan: string;
      tag: string;
      squad: string | null;
      regNo: number | null;
      steamId?: string;
    }
  > = {};

  for (const clan of refreshed) {
    const nickInSquad = new Set<string>();
    for (const squad of clan.squads) {
      for (const m of squad.members) {
        const nick = (m.user.nick || "").trim();
        if (!nick) continue;
        const key = nickKey(nick);
        byNick[key] = {
          clan: clan.name,
          tag: clan.tag,
          squad: squad.name,
          regNo: regByNick.get(key) ?? null,
        };
        nickInSquad.add(key);
      }
    }
    for (const m of clan.members) {
      const nick = (m.user.nick || "").trim();
      if (!nick) continue;
      const key = nickKey(nick);
      if (nickInSquad.has(key) || byNick[key]) continue;
      byNick[key] = {
        clan: clan.name,
        tag: clan.tag,
        squad: null,
        regNo: regByNick.get(key) ?? null,
      };
    }
  }

  for (const u of registered) {
    const nick = (u.nick || "").trim();
    if (!nick) continue;
    const key = nickKey(nick);
    if (!byNick[key]) {
      byNick[key] = {
        clan: "—",
        tag: "",
        squad: null,
        regNo: regByNick.get(key) ?? null,
        steamId: u.steamId,
      };
    } else {
      byNick[key].regNo = regByNick.get(key) ?? null;
      byNick[key].steamId = u.steamId;
    }
  }

  return NextResponse.json(
    {
      byNick,
      registeredCount: registered.length,
      updatedAt: new Date().toISOString(),
    },
    { headers: CORS }
  );
}
