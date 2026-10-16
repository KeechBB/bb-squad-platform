import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/requireAdmin";
import {
  querySysLoad,
  takeSysLoadSample,
  type SysLoadRange,
} from "@/lib/sysLoad";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseRange(raw: string | null): SysLoadRange {
  const v = String(raw || "hours").toLowerCase();
  if (v === "minutes" || v === "hours" || v === "days") return v;
  return "hours";
}

export async function GET(req: Request) {
  const gate = await requireAdmin();
  if (gate.error) return gate.error;

  const url = new URL(req.url);
  const range = parseRange(url.searchParams.get("range"));
  const sampleNow = url.searchParams.get("sample") === "1";

  if (sampleNow) {
    try {
      await takeSysLoadSample();
    } catch {
      /* keep going with history */
    }
  }

  const data = await querySysLoad(range);
  return NextResponse.json(data, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
