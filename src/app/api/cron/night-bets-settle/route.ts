import { NextResponse } from "next/server";
import {
  nightBetWindowAt,
  settleNightBetWindow,
} from "@/lib/factionNightBets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(req: Request): boolean {
  const secret =
    process.env.CRON_SECRET ||
    process.env.ATTENDANCE_CRON_SECRET ||
    "";
  if (!secret) {
    // localhost cron without secret (как faction-race header)
    const h = req.headers.get("x-bb-night-bets-cron");
    return h === "1";
  }
  const auth = req.headers.get("authorization") || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const hdr = req.headers.get("x-cron-secret") || "";
  return bearer === secret || hdr === secret || req.headers.get("x-bb-night-bets-cron") === "1";
}

/** Итог ставок ровно после 01:00 МСК (кто набрал больше гринда за тренировку). */
export async function POST(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const now = new Date();
  const bounds = nightBetWindowAt(now);
  if (now.getTime() < bounds.grindEnd.getTime()) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "before_01:00",
      windowId: bounds.id,
      grindEndIso: bounds.grindEnd.toISOString(),
    });
  }
  const result = await settleNightBetWindow(bounds, now);
  return NextResponse.json({
    ok: true,
    settled: result.settled,
    reason: result.reason,
    windowId: bounds.id,
  });
}

export async function GET(req: Request) {
  return POST(req);
}
