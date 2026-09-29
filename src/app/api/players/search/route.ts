import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/players/search?q=
 * Ник (частичное) или Steam ID. Только для залогиненных с анкетой.
 */
export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.steamId || !session.user.profileComplete) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const q = (new URL(req.url).searchParams.get("q") || "").trim();
  if (q.length < 2) {
    return NextResponse.json({ ok: true, results: [] });
  }
  if (q.length > 64) {
    return NextResponse.json({ error: "too long" }, { status: 400 });
  }

  const digitsOnly = /^\d+$/.test(q);
  const where: Prisma.UserWhereInput = {
    profileComplete: true,
    nick: { not: null },
    OR: digitsOnly
      ? [{ steamId: { contains: q } }, { nick: { contains: q, mode: "insensitive" } }]
      : [
          { nick: { contains: q, mode: "insensitive" } },
          { steamId: { contains: q } },
          { steamName: { contains: q, mode: "insensitive" } },
        ],
  };

  const users = await prisma.user.findMany({
    where,
    take: 10,
    orderBy: [{ nick: "asc" }],
    select: {
      nick: true,
      steamId: true,
      name: true,
      avatarUrl: true,
      steamAvatar: true,
    },
  });

  // Exact nick / exact steam first
  const qLow = q.toLowerCase();
  users.sort((a, b) => {
    const aExact =
      (a.nick || "").toLowerCase() === qLow || a.steamId === q ? 0 : 1;
    const bExact =
      (b.nick || "").toLowerCase() === qLow || b.steamId === q ? 0 : 1;
    if (aExact !== bExact) return aExact - bExact;
    return (a.nick || "").localeCompare(b.nick || "", "ru", {
      sensitivity: "base",
    });
  });

  return NextResponse.json({
    ok: true,
    results: users
      .filter((u) => u.nick)
      .map((u) => ({
        nick: u.nick!,
        steamId: u.steamId,
        name: u.name,
        avatarUrl: u.avatarUrl || u.steamAvatar || null,
      })),
  });
}
