import { NextResponse } from "next/server";
import {
  buildAttendanceStreakBoard,
  emptyAttendanceStreakBoard,
} from "@/lib/attendanceStreaks";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const data = await buildAttendanceStreakBoard();
    return NextResponse.json(
      {
        registered: data.registered,
        anchorYmd: data.anchorYmd,
        top10: data.top10,
        updatedAt: data.updatedAt,
      },
      { headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  } catch (e) {
    const empty = emptyAttendanceStreakBoard();
    return NextResponse.json(
      {
        registered: empty.registered,
        anchorYmd: empty.anchorYmd,
        top10: [],
        updatedAt: empty.updatedAt,
        error: String((e as Error)?.message || e),
      },
      { status: 200 }
    );
  }
}
