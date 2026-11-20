import { NextRequest, NextResponse } from "next/server";
import { tickFactionRace } from "@/lib/factionRaceEngine";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

function authorized(req: NextRequest): boolean {
  const secret = (
    process.env.CRON_SECRET ||
    process.env.ATTENDANCE_CRON_SECRET ||
    ""
  ).trim();
  const hdr =
    req.headers.get("x-cron-secret") ||
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    "";
  if (secret && hdr === secret) return true;
  if (req.headers.get("x-bb-faction-race-cron") === "1") return true;
  const host = (req.headers.get("host") || "").toLowerCase();
  const xf = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim();
  const loopbackHost =
    host.startsWith("127.0.0.1") ||
    host.startsWith("localhost") ||
    host.startsWith("[::1]");
  const loopbackXf = !xf || xf === "127.0.0.1" || xf === "::1";
  if (loopbackHost && loopbackXf) return true;
  return false;
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const report = await tickFactionRace();
    return NextResponse.json(report);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: String((e as Error)?.message || e) },
      { status: 500 },
    );
  }
}

export async function GET(req: NextRequest) {
  return POST(req);
}
