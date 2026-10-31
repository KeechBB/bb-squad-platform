import { NextResponse } from "next/server";
import { loadFruitStrikeLive } from "@/lib/fruitStrikeLive";
import { syncTournamentEliminationMails } from "@/lib/tournamentEliminationMail";

export const dynamic = "force-dynamic";

export async function GET() {
  void syncTournamentEliminationMails();
  const live = await loadFruitStrikeLive();
  const body = live ?? {
    tournamentId: "fruit-strike-s1",
    updatedAt: null,
    matches: {},
    history: [],
    playerStats: [],
    teamStats: [],
  };
  return NextResponse.json(body, {
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      Pragma: "no-cache",
    },
  });
}
