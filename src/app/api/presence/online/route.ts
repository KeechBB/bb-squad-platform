import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { SITE_ONLINE_MS } from "@/lib/presence";

export const dynamic = "force-dynamic";

const CACHE_MS = 15_000;
let cached: { count: number; at: number } | null = null;

/** GET /api/presence/online — сколько человек сейчас на сайте (по heartbeat). */
export async function GET() {
  try {
    const now = Date.now();
    if (cached && now - cached.at < CACHE_MS) {
      return NextResponse.json(
        { count: cached.count },
        {
          headers: {
            "Cache-Control": "public, max-age=15",
            "X-Online-Cache": "hit",
          },
        }
      );
    }
    const since = new Date(now - SITE_ONLINE_MS);
    const count = await prisma.user.count({
      where: { lastSeenAt: { gte: since } },
    });
    cached = { count, at: now };
    return NextResponse.json(
      { count },
      {
        headers: {
          "Cache-Control": "public, max-age=15",
          "X-Online-Cache": "miss",
        },
      }
    );
  } catch {
    return NextResponse.json({ count: cached?.count ?? 0 });
  }
}
