import { NextResponse } from "next/server";
import { getPublicRatingPagePayload } from "@/lib/publicRatingPageCache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Guest JSON for /public — disk snapshot, no heavy SSR payload. */
export async function GET() {
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
