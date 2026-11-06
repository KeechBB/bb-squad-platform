import { NextResponse } from "next/server";
import { getHomeDashboardData } from "@/lib/homePageData";
import { emptyHomeTrainPwrBoard } from "@/lib/homeTrainPwr";

export const dynamic = "force-dynamic";

const hdr = {
  "Cache-Control": "public, max-age=60, stale-while-revalidate=120",
};

export async function GET() {
  try {
    const data = await getHomeDashboardData();
    return NextResponse.json(data.pwrBoard, { headers: hdr });
  } catch (e) {
    return NextResponse.json(
      {
        ...emptyHomeTrainPwrBoard(),
        error: String((e as Error)?.message || e),
      },
      { status: 200, headers: hdr }
    );
  }
}
