import { NextResponse } from "next/server";
import { requireMarketUser } from "@/lib/bbCoinMarketAuth";
import { readCaseJackpots } from "@/lib/caseJackpotPool";
import { canAccessMarketCases } from "@/lib/marketCases";

export const dynamic = "force-dynamic";

export async function GET() {
  const gate = await requireMarketUser();
  if ("error" in gate) return gate.error;
  if (!(await canAccessMarketCases(gate.user.steamId))) {
    return NextResponse.json({ ok: true, access: false });
  }
  const jackpots = await readCaseJackpots();
  return NextResponse.json({ ok: true, access: true, jackpots });
}
