import { NextResponse } from "next/server";
import { requirePanelkaAccess } from "@/lib/requireAdmin";
import {
  buildPb1Analytics,
  mskYmd,
  type Pb1AnalyticsScope,
} from "@/lib/pb1Analytics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseScope(raw: string | null): Pb1AnalyticsScope {
  const v = String(raw || "day").toLowerCase();
  if (v === "week" || v === "month" || v === "year" || v === "day") return v;
  return "day";
}

export async function GET(req: Request) {
  const gate = await requirePanelkaAccess();
  if (gate.error) return gate.error;

  const url = new URL(req.url);
  const scope = parseScope(url.searchParams.get("scope"));
  const today = mskYmd(new Date());
  let key = String(url.searchParams.get("key") || "").trim();
  if (!key) {
    if (scope === "month") key = today.slice(0, 7);
    else if (scope === "year") key = today.slice(0, 4);
    else key = today;
  }

  try {
    const data = await buildPb1Analytics({ scope, key });
    return NextResponse.json(data, {
      headers: { "Cache-Control": "private, max-age=60" },
    });
  } catch (e) {
    console.error("pb1-analytics", e);
    return NextResponse.json(
      { error: "Не удалось посчитать аналитику PB1" },
      { status: 500 }
    );
  }
}
