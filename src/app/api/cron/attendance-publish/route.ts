import { NextRequest, NextResponse } from "next/server";
import { publishAttendanceBoard } from "@/lib/attendancePublish";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

function authorized(req: NextRequest): boolean {
  const secret = (process.env.CRON_SECRET || process.env.ATTENDANCE_CRON_SECRET || "").trim();
  const hdr =
    req.headers.get("x-cron-secret") ||
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    "";
  if (secret && hdr === secret) return true;
  // Local / loopback without secret (plaza cron via 127.0.0.1)
  const host = req.headers.get("host") || "";
  const xf = req.headers.get("x-forwarded-for") || "";
  if (
    (host.startsWith("127.0.0.1") || host.startsWith("localhost")) &&
    (!xf || xf.startsWith("127.0.0.1"))
  ) {
    return true;
  }
  return false;
}

/** Hourly MSK publish — called by cron at :00 Europe/Moscow. */
export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const env = await publishAttendanceBoard();
    return NextResponse.json({
      ok: true,
      hourKey: env.hourKey,
      publishedAt: env.publishedAt,
      registered: env.board.registered,
      top10: env.board.top10.length,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: String((e as Error)?.message || e) },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  return POST(req);
}
