import { NextRequest, NextResponse } from "next/server";
import { buildPublicMatchStats } from "@/lib/publicMatchStats";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const id = String(req.nextUrl.searchParams.get("id") || "").trim();
  if (!id) {
    return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
  }
  try {
    const payload = await buildPublicMatchStats(id);
    if (!payload.ok) {
      const status = payload.error === "not_found" ? 404 : 500;
      return NextResponse.json(payload, { status });
    }
    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120",
      },
    });
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : "fail",
      },
      { status: 500 }
    );
  }
}
