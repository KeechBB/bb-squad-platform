import { NextResponse } from "next/server";
import { getPublicRatingPagePayload } from "@/lib/publicRatingPageCache";
import { buildPublicRatingTable } from "@/lib/publicCombat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Guest JSON for /public — disk snapshot, no heavy SSR payload. */
export async function GET(req: Request) {
  const clan = new URL(req.url).searchParams.get("clan")?.trim() || "";
  if (clan) {
    const board = await buildPublicRatingTable(500, clan);
    return NextResponse.json(
      {
        rows: board.rows,
        matches: board.matches,
        updatedAt: board.updatedAt,
        matchHistory: [],
      },
      {
        headers: {
          "Cache-Control": "public, max-age=30, s-maxage=60",
        },
      }
    );
  }
  const data = await getPublicRatingPagePayload();
  return NextResponse.json(
    {
      rows: data.board.rows,
      matches: data.board.matches,
      updatedAt: data.board.updatedAt,
      matchHistory: data.matchHistory,
      builtAt: data.builtAt,
    },
    {
      headers: {
        "Cache-Control":
          "public, max-age=15, s-maxage=60, stale-while-revalidate=300",
      },
    }
  );
}
