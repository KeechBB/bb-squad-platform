import { NextResponse } from "next/server";
import {
  buildHomeTrainPwrBoard,
  emptyHomeTrainPwrBoard,
} from "@/lib/homeTrainPwr";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const data = await buildHomeTrainPwrBoard();
    return NextResponse.json(data, {
      headers: {
        // short browser/CDN cache — ledger is heavy; avoid stampede on every click
        "Cache-Control": "public, max-age=30, s-maxage=45, stale-while-revalidate=120",
      },
    });
  } catch (e) {
    const empty = emptyHomeTrainPwrBoard();
    return NextResponse.json(
      {
        ...empty,
        error: String((e as Error)?.message || e),
      },
      { status: 200 }
    );
  }
}
