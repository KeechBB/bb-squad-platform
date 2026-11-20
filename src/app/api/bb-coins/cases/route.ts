import { NextResponse } from "next/server";
import { requireMarketUser } from "@/lib/bbCoinMarketAuth";
import type { CaseBoostKind } from "@/lib/marketCaseBoost";
import { readCaseJackpots } from "@/lib/caseJackpotPool";
import {
  abortPendingCaseSpins,
  canAccessMarketCases,
  confirmPendingCaseSpins,
  getMarketCase,
  ensureCaseFunds,
  listMarketCasesPayload,
  openMarketCase,
  type MarketCaseId,
} from "@/lib/marketCases";
import { randomBytes } from "crypto";

export const dynamic = "force-dynamic";

export async function GET() {
  const gate = await requireMarketUser();
  if ("error" in gate) return gate.error;
  const { user } = gate;
  const access = await canAccessMarketCases(user.steamId);
  if (!access) {
    return NextResponse.json({ ok: true, access: false, wip: true, cases: [] });
  }
  const [cases, jackpots] = await Promise.all([
    listMarketCasesPayload(),
    readCaseJackpots(),
  ]);
  return NextResponse.json({ ok: true, access: true, wip: false, cases, jackpots });
}

export async function POST(req: Request) {
  const gate = await requireMarketUser();
  if ("error" in gate) return gate.error;
  const { user } = gate;

  if (!(await canAccessMarketCases(user.steamId))) {
    return NextResponse.json({ ok: false, error: "wip" }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    action?: string;
    caseId?: string;
    boost?: boolean;
    boostKind?: string;
    count?: number;
    batchId?: string;
  };

  if (body.action === "abort") {
    const res = await abortPendingCaseSpins({
      userId: user.id,
      steamId: user.steamId,
      batchId: body.batchId ? String(body.batchId) : undefined,
    });
    const jackpots = await readCaseJackpots();
    return NextResponse.json({ ok: true, ...res, jackpots });
  }

  if (body.action === "confirm") {
    const batchId = String(body.batchId || "");
    if (!batchId) {
      return NextResponse.json({ ok: false, error: "batch" }, { status: 400 });
    }
    const res = await confirmPendingCaseSpins({
      userId: user.id,
      steamId: user.steamId,
      batchId,
    });
    if (!res.ok) {
      const status = res.error === "too_early" ? 425 : 400;
      return NextResponse.json(res, { status });
    }
    return NextResponse.json(res);
  }

  const caseId = String(body.caseId || "") as MarketCaseId;
  if (!getMarketCase(caseId)) {
    return NextResponse.json({ ok: false, error: "case" }, { status: 400 });
  }
  const boostKind: CaseBoostKind | null = body.boostKind === "red" ? "red" : null;
  const count = body.count === 2 ? 2 : 1;
  if (count === 2) {
    const funds = await ensureCaseFunds({
      caseId,
      userId: user.id,
      steamId: user.steamId,
      boostKind,
      count,
    });
    if (!funds.ok) {
      const status =
        funds.error === "insufficient"
          ? 402
          : funds.error === "no_faction"
            ? 403
            : 400;
      return NextResponse.json(funds, { status });
    }
  }

  const batchId = randomBytes(12).toString("hex");
  const spins = [];
  for (let i = 0; i < count; i++) {
    const res = await openMarketCase({
      caseId,
      userId: user.id,
      steamId: user.steamId,
      boostKind,
      batchId,
    });
    if (!res.ok) {
      if (!spins.length) {
        const status =
          res.error === "insufficient"
            ? 402
            : res.error === "wip"
              ? 403
              : res.error === "spin_in_progress"
                ? 409
                : res.error === "forbidden_seat" || res.error === "no_faction"
                  ? 403
                  : 400;
        return NextResponse.json(res, { status });
      }
      break;
    }
    spins.push(res);
  }
  if (!spins.length) {
    return NextResponse.json({ ok: false, error: "empty" }, { status: 400 });
  }
  const last = spins[spins.length - 1];
  return NextResponse.json({
    ...last,
    count: spins.length,
    batchId: last.batchId,
    spins: spins.map((spin) => ({
      result: spin.result,
      strip: spin.strip,
      landIndex: spin.landIndex,
      spent: spin.spent,
      spinId: spin.spinId,
    })),
  });
}
