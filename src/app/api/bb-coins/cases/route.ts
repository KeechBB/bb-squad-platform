import { NextResponse } from "next/server";
import { requireMarketUser } from "@/lib/bbCoinMarketAuth";
import {
  canAccessMarketCases,
  getMarketCase,
  listMarketCasesPayload,
  openMarketCase,
  type MarketCaseId,
} from "@/lib/marketCases";

export const dynamic = "force-dynamic";

export async function GET() {
  const gate = await requireMarketUser();
  if ("error" in gate) return gate.error;
  const { user } = gate;
  const access = await canAccessMarketCases(user.steamId);
  if (!access) {
    return NextResponse.json({ ok: true, access: false, wip: true, cases: [] });
  }
  const cases = await listMarketCasesPayload();
  return NextResponse.json({ ok: true, access: true, wip: false, cases });
}

export async function POST(req: Request) {
  const gate = await requireMarketUser();
  if ("error" in gate) return gate.error;
  const { user } = gate;

  if (!(await canAccessMarketCases(user.steamId))) {
    return NextResponse.json({ ok: false, error: "wip" }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    caseId?: string;
    boost?: boolean;
  };
  const caseId = String(body.caseId || "") as MarketCaseId;
  if (!getMarketCase(caseId)) {
    return NextResponse.json({ ok: false, error: "case" }, { status: 400 });
  }

  const res = await openMarketCase({
    caseId,
    userId: user.id,
    steamId: user.steamId,
    boost: body.boost === true,
  });
  if (!res.ok) {
    const status =
      res.error === "insufficient"
        ? 402
        : res.error === "wip"
          ? 403
          : res.error === "forbidden_seat" || res.error === "no_faction"
            ? 403
            : 400;
    return NextResponse.json(res, { status });
  }
  return NextResponse.json(res);
}
