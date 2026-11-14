import { NextResponse } from "next/server";
import {
  buyMarketBg,
  loadMarketBgCatalog,
  sellMarketBg,
} from "@/lib/bbCoinBgMarket";
import { requireMarketUser } from "@/lib/bbCoinMarketAuth";

export const dynamic = "force-dynamic";

export async function GET() {
  const gate = await requireMarketUser();
  if ("error" in gate) return gate.error;
  const { user } = gate;
  const bgs = await loadMarketBgCatalog({
    userId: user.id,
    steamId: user.steamId,
  });
  return NextResponse.json({ ok: true, bgs });
}

export async function POST(req: Request) {
  const gate = await requireMarketUser();
  if ("error" in gate) return gate.error;
  const { user } = gate;

  const body = (await req.json().catch(() => ({}))) as {
    action?: string;
    bgId?: string;
  };
  const action = String(body.action || "");
  const bgId = String(body.bgId || "");

  if (action === "buy") {
    const res = await buyMarketBg({ userId: user.id, bgId });
    if (!res.ok) {
      const status = res.error === "insufficient" ? 402 : 400;
      return NextResponse.json(res, { status });
    }
    return NextResponse.json(res);
  }

  if (action === "sell") {
    const res = await sellMarketBg({ userId: user.id, bgId });
    if (!res.ok) {
      const status = res.error === "not_owned" ? 409 : 400;
      return NextResponse.json(res, { status });
    }
    return NextResponse.json(res);
  }

  return NextResponse.json({ ok: false, error: "action" }, { status: 400 });
}
