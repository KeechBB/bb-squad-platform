import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { isAdmin, syncBuiltinAdmins } from "@/lib/admin";
import {
  listBbTrainDates,
  loadBbTrainReport,
  type BbTrainSlot,
} from "@/lib/bbTrainReport";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function mskToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
  }).format(new Date());
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.steamId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  await syncBuiltinAdmins();
  if (!(await isAdmin(session.user.steamId))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const dates = await listBbTrainDates();
  const askedDate = req.nextUrl.searchParams.get("date") || "";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(askedDate)
    ? askedDate
    : dates[0] || mskToday();
  const askedSlot = req.nextUrl.searchParams.get("slot");
  const slot: BbTrainSlot = askedSlot === "2130" ? "2130" : "0100";
  const report = await loadBbTrainReport(date, slot);

  return NextResponse.json(
    { dates, date, slot, report },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}
