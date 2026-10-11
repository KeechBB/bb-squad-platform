/**
 * When a player joins any clan — enqueue TR1/TR2 session backfill so prior
 * CW/train log rows attach to their profile (same path as registration).
 */
import { prisma } from "@/lib/prisma";

export async function enqueueClanJoinLogBackfill(opts: {
  userId: string;
  steamId: string;
  nick: string;
}): Promise<{ enqueued: boolean; jobId?: string }> {
  const steamId = String(opts.steamId || "").trim();
  const userId = String(opts.userId || "").trim();
  if (!steamId || !userId) return { enqueued: false };

  try {
    await prisma.squadServerSession.updateMany({
      where: { steamId, userId: null },
      data: { userId },
    });
  } catch (err) {
    console.error("[clanJoinBackfill] attach orphan sessions", err);
  }

  try {
    const existing = await prisma.squadLogBackfillJob.findFirst({
      where: {
        steamId,
        status: { in: ["pending", "running"] },
      },
      select: { id: true },
    });
    if (existing) return { enqueued: false, jobId: existing.id };

    const job = await prisma.squadLogBackfillJob.create({
      data: {
        userId,
        steamId,
        nick: String(opts.nick || "").trim() || steamId,
        status: "pending",
      },
      select: { id: true },
    });
    return { enqueued: true, jobId: job.id };
  } catch (err) {
    console.error("[clanJoinBackfill] enqueue failed", err);
    return { enqueued: false };
  }
}
