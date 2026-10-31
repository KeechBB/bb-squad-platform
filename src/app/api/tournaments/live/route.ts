import { NextResponse } from "next/server";
import { loadFruitStrikeLive } from "@/lib/fruitStrikeLive";

export const dynamic = "force-dynamic";

export async function GET() {
  const live = await loadFruitStrikeLive();
  if (!live) {
    return NextResponse.json({
      tournamentId: "fruit-strike-s1",
      updatedAt: null,
      matches: {},
      history: [],
      playerStats: [],
      teamStats: [],
    });
  }
  return NextResponse.json(live);
}
