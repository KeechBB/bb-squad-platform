import { NextResponse } from "next/server";
import { kitAveragesByTier, kitRankAnalytics } from "@/lib/squadRoles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "no-store",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

/** Средние % китов по тирам 1–4 + рейтинг ур.1–3 (для «Прочая статистика» ТМ). */
export async function GET() {
  try {
    const [tiers, ranking] = await Promise.all([
      kitAveragesByTier(),
      kitRankAnalytics(),
    ]);
    return NextResponse.json(
      { ok: true, tiers, ranking, updatedAt: new Date().toISOString() },
      { headers: CORS }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { ok: false, error: msg },
      { status: 500, headers: CORS }
    );
  }
}
