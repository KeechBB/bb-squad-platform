import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { bonesForUser, hitDaysForUser } from "@/lib/squadHits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/hitmap?userId=…&day=YYYY-MM-DD
 * day — сутки по МСК; без day — всё время.
 * days=1 — дополнительно список дней с попаданиями.
 */
export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.steamId || !session.user.profileComplete) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const userId = (url.searchParams.get("userId") || "").trim();
  if (!userId) {
    return NextResponse.json({ error: "userId required" }, { status: 400 });
  }
  const day = (url.searchParams.get("day") || "").trim() || null;
  if (day && !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return NextResponse.json({ error: "bad day" }, { status: 400 });
  }
  const wantDays = url.searchParams.get("days") === "1";

  const target = await prisma.user.findFirst({
    where: { id: userId, profileComplete: true },
    select: { id: true },
  });
  if (!target) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const [stats, days] = await Promise.all([
    bonesForUser(userId, { dayYmd: day }),
    wantDays ? hitDaysForUser(userId) : Promise.resolve(null),
  ]);

  return NextResponse.json({
    ok: true,
    day,
    bones: stats.bones,
    total: stats.total,
    lastBone: stats.lastBone,
    days: days || undefined,
  });
}
