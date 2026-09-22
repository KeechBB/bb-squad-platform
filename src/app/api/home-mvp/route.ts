import { NextResponse } from "next/server";
import { buildHomeMvpBoard } from "@/lib/homeMvp";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const data = await buildHomeMvpBoard();
    return NextResponse.json(data, {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    });
  } catch (e) {
    const { emptyHomeMvpBoard } = await import("@/lib/homeMvp");
    return NextResponse.json(
      {
        ...emptyHomeMvpBoard(),
        error: String((e as Error)?.message || e),
      },
      { status: 200 }
    );
  }
}
