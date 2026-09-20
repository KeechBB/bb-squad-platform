import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { SITE_HEARTBEAT_WRITE_MS } from "@/lib/presence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.steamId || !session.user.profileComplete) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { steamId: session.user.steamId },
    select: { id: true, lastSeenAt: true },
  });
  if (!user) {
    return NextResponse.json({ ok: false }, { status: 404 });
  }

  const now = Date.now();
  const last = user.lastSeenAt?.getTime() ?? 0;
  if (now - last < SITE_HEARTBEAT_WRITE_MS) {
    return NextResponse.json({
      ok: true,
      lastSeenAt: user.lastSeenAt?.toISOString() ?? null,
      skipped: true,
    });
  }

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { lastSeenAt: new Date(now) },
    select: { lastSeenAt: true },
  });

  return NextResponse.json({
    ok: true,
    lastSeenAt: updated.lastSeenAt?.toISOString() ?? null,
  });
}
