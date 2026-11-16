import { NextResponse } from "next/server";
import { requireKeechOnly } from "@/lib/requireAdmin";
import { creditGrindRecentTrains } from "@/lib/factionTransfers";

export const runtime = "nodejs";

/** Ручной прогон гринда с последних TRAIN в казны фракций. */
export async function POST(req: Request) {
  const gate = await requireKeechOnly();
  if (gate.error) return gate.error;
  const body = (await req.json().catch(() => null)) as { limit?: number } | null;
  const limit = Math.min(120, Math.max(5, Number(body?.limit) || 40));
  const credited = await creditGrindRecentTrains(limit);
  return NextResponse.json({ ok: true, credited, limit });
}
