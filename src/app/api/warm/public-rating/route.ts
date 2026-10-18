import { NextResponse } from "next/server";
import { getPublicRatingPagePayload } from "@/lib/publicRatingPageCache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Прогрев паблик-таблицы + disk snapshot (cron) — без auth. */
export async function GET() {
  const t0 = Date.now();
  const data = await getPublicRatingPagePayload({ force: true });
  return NextResponse.json({
    ok: true,
    rows: data.board.rows.length,
    matches: data.board.matches,
    history: data.matchHistory.length,
    builtAt: data.builtAt,
    ms: Date.now() - t0,
  });
}
