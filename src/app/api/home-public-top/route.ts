import { NextResponse } from "next/server";
import { buildPublicRpLeaderboard } from "@/lib/publicRp";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const d = await buildPublicRpLeaderboard();
    const rows = d.rows.slice(0, 10).map((r) => ({
      nick: r.nick,
      rp: r.rp,
      rankLabel: r.rankLabel,
      rankKey: r.rankKey,
      games: r.games || 0,
      place: r.place || 0,
    }));
    return NextResponse.json(
      {
        rows,
        players: d.players,
        matches: d.matches,
        updatedAt: d.updatedAt,
      },
      {
        headers: {
          "Cache-Control":
            "public, max-age=30, s-maxage=45, stale-while-revalidate=120",
        },
      }
    );
  } catch (e) {
    return NextResponse.json(
      {
        rows: [],
        players: 0,
        matches: 0,
        updatedAt: new Date().toISOString(),
        error: String((e as Error)?.message || e),
      },
      { status: 200 }
    );
  }
}
