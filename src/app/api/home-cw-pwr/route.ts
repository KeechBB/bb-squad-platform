import { NextResponse } from "next/server";
import { snapshotOrBuild } from "@/lib/diskSnapshot";
import { buildHomeCwPwrBoard, emptyHomeCwPwrBoard } from "@/lib/homeCwPwr";

export const dynamic = "force-dynamic";

const hdr = {
  "Cache-Control": "public, max-age=60, stale-while-revalidate=120",
};

export async function GET() {
  try {
    const data = await snapshotOrBuild("home-cw-pwr.json", 90_000, () =>
      buildHomeCwPwrBoard()
    );
    return NextResponse.json(data, { headers: hdr });
  } catch {
    return NextResponse.json(emptyHomeCwPwrBoard(), { status: 200, headers: hdr });
  }
}
