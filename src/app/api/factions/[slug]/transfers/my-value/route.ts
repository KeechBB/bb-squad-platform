import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { loadFactionView } from "@/lib/factions";
import { loadMyValueReport } from "@/lib/playerValueBonus";
import { resolveFactionAngel } from "@/lib/nickCollisions";

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
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { nick: true, steamName: true, steamId: true },
  });

  // Те же цифры/кит, что в колонке «Стоимость» состава — без второго расчёта кита.
  const kit = me.mainKit && me.mainKit !== "—" ? me.mainKit : null;
  const nick = user?.nick || me.nick;
  const resolvedSteam = user?.steamId || steamId;
  const factionAngel = resolveFactionAngel({
    nick,
    steamName: user?.steamName,
    steamId: resolvedSteam,
  });

  const report = await loadMyValueReport({
    userId,
    nick: factionAngel?.siteNick || nick,
    steamName: user?.steamName || null,
    steamId: factionAngel?.steamId || resolvedSteam,
    marketValue: me.marketValue,
    grindBroughtBd: me.grindBroughtBd,
    estimate: me.playerValue,
    kit,
  });

  return NextResponse.json(report);
}
