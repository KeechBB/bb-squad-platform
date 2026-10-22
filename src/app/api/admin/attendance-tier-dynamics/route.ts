import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { isAdmin, syncBuiltinAdmins } from "@/lib/admin";
import {
  availableDynamicsMonths,
  buildEveningTierDynamics,
} from "@/lib/trainEveningTiers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const session = await getSession();
  if (!session?.user?.steamId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  await syncBuiltinAdmins();
  if (!(await isAdmin(session.user.steamId))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const modeRaw = (url.searchParams.get("mode") || "week").toLowerCase();
  const mode = modeRaw === "month" ? "month" : "week";
  const month = url.searchParams.get("month");
  const end = url.searchParams.get("end");

  try {
    const board = await buildEveningTierDynamics({ mode, month, end });
    return NextResponse.json({
      ...board,
      months: availableDynamicsMonths(),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
