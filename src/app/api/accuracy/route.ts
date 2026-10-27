import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { snapshotKey, snapshotOrBuild } from "@/lib/diskSnapshot";
import { prisma } from "@/lib/prisma";
import { accuracyForNick } from "@/lib/trainAccuracy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/accuracy?nick=… | userId=… [&matchId=…]
 * Точность = попадания ÷ выстрелы (accuracy-stats.json).
 * Без matchId — сумма зачётных каток; с matchId — слот этой катки.
 */
export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.steamId || !session.user.profileComplete) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const userId = (url.searchParams.get("userId") || "").trim();
  let nick = (url.searchParams.get("nick") || "").trim();
  const matchId = (url.searchParams.get("matchId") || "").trim() || null;

  if (!nick && userId) {
    const user = await prisma.user.findFirst({
      where: { id: userId, profileComplete: true },
      select: { nick: true, steamName: true },
    });
    if (!user) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    nick = (user.nick || user.steamName || "").trim();
  }
  if (!nick) {
    return NextResponse.json(
      { error: "nick or userId required" },
      { status: 400 }
    );
  }

  const body = await snapshotOrBuild(
    `queries/accuracy-${snapshotKey([nick, matchId || ""])}.json`,
    60_000,
    async () => {
      const slot = await accuracyForNick(nick, matchId);
      return {
        ok: true,
        nick,
        matchId,
        hits: slot?.hits ?? null,
        shots: slot?.shots ?? null,
        accuracyPct: slot?.accuracyPct ?? null,
      };
    }
  );

  return NextResponse.json(body, {
    headers: {
      "Cache-Control": "private, max-age=30, stale-while-revalidate=120",
    },
  });
}
