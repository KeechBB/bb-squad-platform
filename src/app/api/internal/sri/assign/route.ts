import { NextResponse } from "next/server";
import { assignFreeAgentBySteam, distributeAllFreeAgents } from "@/lib/sri";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(req: Request): boolean {
  const secret =
    process.env.SRI_SECRET ||
    process.env.CRON_SECRET ||
    process.env.ATTENDANCE_CRON_SECRET ||
    "";
  if (!secret) return false;
  const header = req.headers.get("x-sri-secret") || req.headers.get("authorization") || "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  return token === secret;
}

/**
 * POST { steamId, reason?: "recruit"|"reserve_exit"|"balance_batch" }
 * POST { all: true } — раздать всех свободных агентов
 */
export async function POST(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = (await req.json().catch(() => null)) as {
    steamId?: string;
    reason?: "recruit" | "reserve_exit" | "balance_batch";
    all?: boolean;
  } | null;

  if (body?.all) {
    const report = await distributeAllFreeAgents({
      reason: body.reason || "balance_batch",
    });
    return NextResponse.json({ ok: true, report });
  }

  const steamId = (body?.steamId || "").trim();
  if (!steamId) {
    return NextResponse.json({ error: "steamId required" }, { status: 400 });
  }
  const result = await assignFreeAgentBySteam(
    steamId,
    body?.reason || "recruit"
  );
  return NextResponse.json({ ok: result.ok, result });
}
