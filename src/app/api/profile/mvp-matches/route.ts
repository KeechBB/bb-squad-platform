import { NextResponse } from "next/server";
import { buildPlayerTrainCombatStats } from "@/lib/homeTrainPwr";
import { buildPlayerKvStats } from "@/lib/kvStats";
import { buildPlayerPublicMvpHits } from "@/lib/publicCombat";
import { mvpHitsFromKvAwards } from "@/lib/mvpHits";

export const dynamic = "force-dynamic";

type Kind = "killer" | "medic" | "armor";

function isKind(v: string): v is Kind {
  return v === "killer" || v === "medic" || v === "armor";
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const nick = String(url.searchParams.get("nick") || "").trim();
  const mode = String(url.searchParams.get("mode") || "").trim();
  const kindRaw = String(url.searchParams.get("kind") || "").trim();
  if (!nick || !isKind(kindRaw)) {
    return NextResponse.json({ hits: [] }, { status: 400 });
  }
  const kind = kindRaw;

  try {
    if (mode === "train") {
      const stats = await buildPlayerTrainCombatStats(nick);
      return NextResponse.json({ hits: stats?.mvpHits?.[kind] || [] });
    }
    if (mode === "cw") {
      const stats = await buildPlayerKvStats(nick);
      const hits = mvpHitsFromKvAwards(stats?.awards || []);
      return NextResponse.json({ hits: hits[kind] });
    }
    if (mode === "public") {
      const hits = await buildPlayerPublicMvpHits(nick);
      return NextResponse.json({ hits: hits[kind] });
    }
    return NextResponse.json({ hits: [] }, { status: 400 });
  } catch {
    return NextResponse.json({ hits: [] }, { status: 500 });
  }
}
