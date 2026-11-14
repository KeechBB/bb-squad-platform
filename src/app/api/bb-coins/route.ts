import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { BB_COIN_PACKAGES, getBbCoinBalance } from "@/lib/bbCoins";
import { settleActiveTournamentBbCoins } from "@/lib/bbCoinsTournament";
import { loadMarketPatchCatalog } from "@/lib/bbCoinPatchMarket";
import { loadMarketBgCatalog } from "@/lib/bbCoinBgMarket";
import { loadMarketFontCatalog } from "@/lib/bbCoinFontMarket";
import { requireMarketUser } from "@/lib/bbCoinMarketAuth";

export const dynamic = "force-dynamic";

export async function GET() {
  const gate = await requireMarketUser();
  if ("error" in gate) return gate.error;
  const { user } = gate;

  const settled = await settleActiveTournamentBbCoins(user.id).catch(() => ({
    granted: 0,
  }));
  const balance = await getBbCoinBalance(user.id);
  const [txs, patches, bgs, fonts] = await Promise.all([
    prisma.bbCoinTx.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    loadMarketPatchCatalog({ userId: user.id, steamId: user.steamId }),
    loadMarketBgCatalog({ userId: user.id, steamId: user.steamId }),
    loadMarketFontCatalog({ userId: user.id, steamId: user.steamId }),
  ]);

  return NextResponse.json({
    ok: true,
    balance,
    grantedNow: settled.granted || 0,
    packages: BB_COIN_PACKAGES,
    patches,
    bgs,
    fonts,
    txs: txs.map((t) => ({
      id: t.id,
      delta: t.delta,
      balanceAfter: t.balanceAfter,
      kind: t.kind,
      note: t.note,
      at: t.createdAt,
    })),
  });
}
