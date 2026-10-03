import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { SITE_ONLINE_MS } from "@/lib/presence";

export const dynamic = "force-dynamic";

/** GET /api/presence/online — сколько человек сейчас на сайте (по heartbeat). */
export async function GET() {
  try {
    const since = new Date(Date.now() - SITE_ONLINE_MS);
    const count = await prisma.user.count({
      where: { lastSeenAt: { gte: since } },
    });
    return NextResponse.json(
      { count },
      { headers: { "Cache-Control": "public, max-age=15" } }
    );
  } catch {
    return NextResponse.json({ count: 0 });
  }
}
