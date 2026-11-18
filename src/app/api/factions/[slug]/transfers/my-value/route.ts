import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { loadFactionView } from "@/lib/factions";
import {
  buildFactionKitScarcity,
  estimateWithKit,
  loadPlayerPriceStats,
  normalizeKit,
} from "@/lib/factionTransfers";
import { loadMyValueReport } from "@/lib/playerValueBonus";
import { mainKitByUserIds } from "@/lib/squadRoles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const session = await getServerSession(authOptions);
  const steamId = session?.user?.steamId ?? null;
  if (!steamId) {
    return NextResponse.json({ error: "Нужен вход" }, { status: 401 });
  }

  const { slug } = await ctx.params;
  const loaded = await loadFactionView(decodeURIComponent(slug), steamId);
  if (loaded.error || !loaded.view) {
    return NextResponse.json({ error: "Нет доступа" }, { status: 404 });
  }

  const me = loaded.view.myUserId
    ? loaded.view.members.find((m) => m.userId === loaded.view!.myUserId)
    : null;
  if (!me || !loaded.view.myUserId) {
    return NextResponse.json(
      { error: "Ты не в составе этой фракции" },
      { status: 403 },
    );
  }

  const userId = loaded.view.myUserId;
  const [scarcity, priceStats, kits, user] = await Promise.all([
    buildFactionKitScarcity(loaded.view.id),
    loadPlayerPriceStats([userId]),
    mainKitByUserIds([userId]),
    prisma.user.findUnique({
      where: { id: userId },
      select: { nick: true, steamName: true, steamId: true },
    }),
  ]);

  const kit = kits.get(userId) || me.mainKit || null;
  const kitKey = normalizeKit(kit);
  const scarcityByKit = Object.fromEntries(
    scarcity.byKit.map((r) => [r.kitKey, r.level as "ok" | "thin" | "critical" | "surplus"]),
  );
  const st = priceStats.get(userId);
  const grindBroughtBd = Math.max(0, Math.round(st?.grindBroughtBd || 0));
  const marketValue = estimateWithKit(
    st ? { ...st, grindBroughtBd: 0 } : undefined,
    kit,
    scarcityByKit[kitKey],
  );
  const estimate = estimateWithKit(st, kit, scarcityByKit[kitKey]);

  const report = await loadMyValueReport({
    userId,
    nick: user?.nick || me.nick,
    steamName: user?.steamName || null,
    steamId: user?.steamId || steamId,
    marketValue,
    grindBroughtBd,
    estimate,
    kit,
  });

  return NextResponse.json(report);
}
