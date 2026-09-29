import { NextResponse } from "next/server";
import { hitmapAveragesByTier } from "@/lib/squadHits";

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

/** Средние карты попаданий по тирам 1–4 (для аналитики ТМ в KV). */
export async function GET() {
  try {
    const tiers = await hitmapAveragesByTier();
    return NextResponse.json(
      { ok: true, tiers, updatedAt: new Date().toISOString() },
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
