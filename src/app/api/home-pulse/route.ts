import { NextResponse } from "next/server";
import { buildCalendarMatches } from "@/lib/kvForecast";
import {
  buildAttendanceStreakBoard,
  emptyAttendanceStreakBoard,
} from "@/lib/attendanceStreaks";
import { memoTtl } from "@/lib/memoTtl";

export const dynamic = "force-dynamic";

async function loadPulse() {
  const [cal, streaks] = await Promise.all([
    buildCalendarMatches()
      .then((d) => d.previews || [])
      .catch(() => [] as Awaited<ReturnType<typeof buildCalendarMatches>>["previews"]),
    buildAttendanceStreakBoard().catch(() => emptyAttendanceStreakBoard()),
  ]);
  const upcoming = cal.slice(0, 2);
  return {
    nextMatch: upcoming[0] || null,
    upcoming,
    streakLeader: streaks.top10[0]
      ? {
          nick: streaks.top10[0].nick,
          attendStreak: streaks.top10[0].attendStreak,
        }
      : null,
    streakRegistered: streaks.registered,
    updatedAt: new Date().toISOString(),
  };
}

export async function GET() {
  try {
    const data = await memoTtl("home-pulse-v1", 60_000, loadPulse);
    return NextResponse.json(data, {
      headers: {
        "Cache-Control":
          "public, max-age=20, s-maxage=45, stale-while-revalidate=60",
      },
    });
  } catch (e) {
    return NextResponse.json(
      {
        nextMatch: null,
        upcoming: [],
        streakLeader: null,
        streakRegistered: 0,
        updatedAt: new Date().toISOString(),
        error: String((e as Error)?.message || e),
      },
      { status: 200 }
    );
  }
}
