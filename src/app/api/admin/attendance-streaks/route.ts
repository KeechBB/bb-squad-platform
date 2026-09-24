import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { isAdmin, syncBuiltinAdmins } from "@/lib/admin";
import {
  buildAttendanceStreakBoard,
  emptyAttendanceStreakBoard,
} from "@/lib/attendanceStreaks";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const session = await getSession();
  if (!session?.user?.steamId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  await syncBuiltinAdmins();
  if (!(await isAdmin(session.user.steamId))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const data = await buildAttendanceStreakBoard();
    return NextResponse.json(data, {
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (e) {
    return NextResponse.json(
      {
        ...emptyAttendanceStreakBoard(),
        error: String((e as Error)?.message || e),
      },
      { status: 200 }
    );
  }
}
