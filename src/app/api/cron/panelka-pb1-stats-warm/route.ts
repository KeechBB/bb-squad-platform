import { NextRequest, NextResponse } from "next/server";
import {
  warmPanelkaPb1StatsBatch,
  verifyPb1StatsSample,
} from "@/lib/panelkaPlayerPb1Stats";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

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
  if (req.headers.get("x-bb-panelka-pb1-warm") === "1") return true;
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

/** Warm PB1 player-card stats cache (admin panel). */
export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const body = (await req.json().catch(() => ({}))) as {
      limit?: number;
      verify?: boolean;
      skipLiveIp?: boolean;
    };
    const warm = await warmPanelkaPb1StatsBatch({
      limit: body.limit,
      skipLiveIp: body.skipLiveIp !== false,
    });
    let verify = null as Awaited<ReturnType<typeof verifyPb1StatsSample>> | null;
    if (body.verify) {
      verify = await verifyPb1StatsSample({ sample: 10 });
    }
    return NextResponse.json({ ok: true, warm, verify });
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
