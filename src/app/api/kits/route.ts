import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { kitDaysForUser, kitsForUser } from "@/lib/squadRoles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/kits?userId=…
 *   day=YYYY-MM-DD — сутки МСК
 *   from=&to= — интервал МСК включительно
 *   days=1 — список дней со спавнами
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
  const from = (url.searchParams.get("from") || "").trim() || null;
  const to = (url.searchParams.get("to") || "").trim() || null;
  const ymdOk = (s: string | null) => !s || /^\d{4}-\d{2}-\d{2}$/.test(s);
  if (!ymdOk(day) || !ymdOk(from) || !ymdOk(to)) {
    return NextResponse.json({ error: "bad date" }, { status: 400 });
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
    kitsForUser(userId, {
      dayYmd: day,
      fromYmd: from,
      toYmd: to,
    }),
    wantDays ? kitDaysForUser(userId) : Promise.resolve(null),
  ]);

  return NextResponse.json({
    ok: true,
    day,
    from,
    to,
    kits: stats.kits,
    total: stats.total,
    days: days || undefined,
  });
}
