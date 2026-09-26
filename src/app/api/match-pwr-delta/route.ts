import { NextRequest, NextResponse } from "next/server";
import {
  buildCwMatchPwrDeltas,
  buildTrainMatchPwrDeltas,
} from "@/lib/matchPwrDelta";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const kind = (req.nextUrl.searchParams.get("kind") || "").toLowerCase();
  const matchId = String(req.nextUrl.searchParams.get("matchId") || "").trim();
  if (!matchId || (kind !== "cw" && kind !== "train")) {
    return NextResponse.json(
      { error: "kind=cw|train and matchId required" },
      { status: 400 }
    );
  }
  try {
    const deltas =
      kind === "cw"
        ? await buildCwMatchPwrDeltas(matchId)
        : await buildTrainMatchPwrDeltas(matchId);
    return NextResponse.json(
      { matchId, kind, deltas },
      {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120",
        },
      }
    );
  } catch {
    return NextResponse.json(
      { matchId, kind, deltas: {} },
      {
        status: 200,
        headers: { "Access-Control-Allow-Origin": "*" },
      }
    );
  }
}
