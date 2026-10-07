import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  bonesForUser,
  bonesForUserMatch,
  bonesForSteamIds,
  bonesForSteamMatch,
} from "@/lib/squadHits";
import { normalizeSteamId } from "@/lib/squadSessions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/hitmap?userId=… | steamId=…
 *   &matchId=… — попадания за тренировочный матч (только userId)
 *   &day=YYYY-MM-DD — сутки по МСК (legacy)
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
  if (!userId && !steamId) {
    return NextResponse.json(
      { error: "userId or steamId required" },
      { status: 400 }
    );
  }
  const matchId = (url.searchParams.get("matchId") || "").trim() || null;
  const day = (url.searchParams.get("day") || "").trim() || null;
  if (day && !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return NextResponse.json({ error: "bad day" }, { status: 400 });
  }

  if (userId) {
    const target = await prisma.user.findFirst({
      where: { id: userId, profileComplete: true },
      select: { id: true },
    });
    if (!target) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }

    if (matchId) {
      const stats = await bonesForUserMatch(userId, matchId);
      if (!stats) {
        return NextResponse.json({ error: "match not found" }, { status: 404 });
      }
      return NextResponse.json({
        ok: true,
        matchId,
        day: null,
        bones: stats.bones,
        total: stats.total,
        lastBone: stats.lastBone,
      });
    }

    const stats = await bonesForUser(userId, { dayYmd: day });
    return NextResponse.json({
      ok: true,
      matchId: null,
      day,
      bones: stats.bones,
      total: stats.total,
      lastBone: stats.lastBone,
    });
  }

  if (matchId) {
    const stats = await bonesForSteamMatch([steamId], matchId);
    if (!stats) {
      return NextResponse.json({ error: "match not found" }, { status: 404 });
    }
    return NextResponse.json({
      ok: true,
      matchId,
      day: null,
      bones: stats.bones,
      total: stats.total,
      lastBone: stats.lastBone,
    });
  }

  const stats = await bonesForSteamIds([steamId], { dayYmd: day });
  return NextResponse.json({
    ok: true,
    matchId: null,
    day,
    bones: stats.bones,
    total: stats.total,
    lastBone: stats.lastBone,
  });
}
