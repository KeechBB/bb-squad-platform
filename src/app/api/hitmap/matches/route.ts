import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { buildHitmapMatchOptions } from "@/lib/squadHits";
import { normalizeSteamId } from "@/lib/squadSessions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/hitmap/matches?userId=… | steamId=… [&nick=…]
 * Матчи/раунды, где у игрока есть BBHitZone-хиты.
 */
export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.steamId || !session.user.profileComplete) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const userId = (url.searchParams.get("userId") || "").trim();
  const steamRaw = (url.searchParams.get("steamId") || "").trim();
  const steamId = normalizeSteamId(steamRaw) || steamRaw || "";
  let nick = (url.searchParams.get("nick") || "").trim();

  if (!userId && !steamId) {
    return NextResponse.json(
      { error: "userId or steamId required" },
      { status: 400 }
    );
  }

  const steamIds: string[] = [];
  if (userId) {
    const user = await prisma.user.findFirst({
      where: { id: userId, profileComplete: true },
      select: { id: true, nick: true, steamId: true, steamName: true },
    });
    if (!user) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    if (!nick) nick = user.nick || user.steamName || "";
    if (user.steamId) steamIds.push(user.steamId);
  }
  if (steamId) steamIds.push(steamId);

  const matches = await buildHitmapMatchOptions({
    userId: userId || null,
    steamIds,
    nick: nick || null,
  });

  return NextResponse.json({ ok: true, matches });
}
