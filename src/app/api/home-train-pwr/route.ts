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
      headers: { "Cache-Control": "no-store, max-age=0" },
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
