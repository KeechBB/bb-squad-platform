import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isBuiltinSuperAdmin } from "@/lib/admin";
import { BB_COIN_PACKAGES, getBbCoinBalance } from "@/lib/bbCoins";
import { settleActiveTournamentBbCoins } from "@/lib/bbCoinsTournament";
import { loadMarketPatchCatalog } from "@/lib/bbCoinPatchMarket";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.steamId) {
    return NextResponse.json({ ok: false, error: "auth" }, { status: 401 });
  }
  if (!isBuiltinSuperAdmin(session.user.steamId)) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }
  const user = await prisma.user.findUnique({
    where: { steamId: session.user.steamId },
    select: { id: true, profileComplete: true, steamId: true },
  });
  if (!user?.profileComplete) {
    return NextResponse.json({ ok: false, error: "profile" }, { status: 403 });
  }

  const settled = await settleActiveTournamentBbCoins(user.id).catch(() => ({
    granted: 0,
  }));
  const balance = await getBbCoinBalance(user.id);
  const [txs, patches] = await Promise.all([
    prisma.bbCoinTx.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    loadMarketPatchCatalog({ userId: user.id, steamId: user.steamId }),
  ]);

  return NextResponse.json({
    ok: true,
    balance,
    grantedNow: settled.granted || 0,
    packages: BB_COIN_PACKAGES,
    patches,
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
