import { NextResponse } from "next/server";
import { emptyAttendanceStreakBoard } from "@/lib/attendanceStreaks";
import {
  getPublishedAttendanceBoard,
  readAttendancePublished,
} from "@/lib/attendancePublish";

export const dynamic = "force-dynamic";

const hdr = {
  "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
  "X-Attendance-Publish": "hourly-msk",
};

export async function GET() {
  try {
    const meta = await readAttendancePublished();
    const data = await getPublishedAttendanceBoard();
    return NextResponse.json(
      {
        registered: data.registered,
        anchorYmd: data.anchorYmd,
        top10: data.top10,
        updatedAt: data.updatedAt,
        publishedAt: meta?.publishedAt ?? data.updatedAt,
        hourKey: meta?.hourKey ?? null,
      },
      { headers: hdr }
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
      { status: 200, headers: hdr }
    );
  }
}
