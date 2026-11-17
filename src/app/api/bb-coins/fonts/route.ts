import { NextResponse } from "next/server";
import {
  buyMarketFont,
  loadMarketFontCatalog,
  sellMarketFont,
} from "@/lib/bbCoinFontMarket";
import { requireMarketUser } from "@/lib/bbCoinMarketAuth";

export const dynamic = "force-dynamic";

export async function GET() {
  const gate = await requireMarketUser();
  if ("error" in gate) return gate.error;
  const { user } = gate;
  const fonts = await loadMarketFontCatalog({
    userId: user.id,
    steamId: user.steamId,
  });
  return NextResponse.json({ ok: true, fonts });
}

export async function POST(req: Request) {
  const gate = await requireMarketUser();
  if ("error" in gate) return gate.error;
  const { user } = gate;

  const body = (await req.json().catch(() => ({}))) as {
    action?: string;
    styleId?: string;
  };
  const action = String(body.action || "");
  const styleId = String(body.styleId || "");

  if (action === "buy") {
    const res = await buyMarketFont({
      userId: user.id,
      steamId: user.steamId,
      styleId,
    });
    if (!res.ok) {
      const status = res.error === "insufficient" ? 402 : 400;
      return NextResponse.json(res, { status });
    }
    return NextResponse.json(res);
  }

  if (action === "sell") {
    const res = await sellMarketFont({
      userId: user.id,
      steamId: user.steamId,
      styleId,
    });
    if (!res.ok) {
      const status = res.error === "not_owned" ? 409 : 400;
      return NextResponse.json(res, { status });
    }
    return NextResponse.json(res);
  }

  return NextResponse.json({ ok: false, error: "action" }, { status: 400 });
}
