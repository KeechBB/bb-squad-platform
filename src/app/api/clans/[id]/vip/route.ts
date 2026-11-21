import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  canGrantClanVip,
  clanAllowsVipGrants,
  resolveClanActor,
} from "@/lib/clanActor";
import { grantPublicVip } from "@/lib/panelkaVipBan";
import { personLabel } from "@/lib/actionLog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Глава / зам (или владелец платформы) выдаёт VIP члену клана:
 * QueuePriority — без очереди + balance/teamchange на паблике.
 * Слотов без лимита. Пишется в Admins.cfg и в лог випок админки.
 */
export async function POST(req: Request, ctx: Ctx) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.steamId) {
    return NextResponse.json({ error: "Нужен вход" }, { status: 401 });
  }
  const { id: clanId } = await ctx.params;
  const clan = await prisma.clan.findUnique({
    where: { id: clanId },
    select: { id: true, tag: true, name: true },
  });
  if (!clan) {
    return NextResponse.json({ error: "Клан не найден" }, { status: 404 });
  }
  if (!clanAllowsVipGrants(clan.tag)) {
    return NextResponse.json(
      { error: "В этом клане VIP с сайта не выдаётся" },
      { status: 403 }
    );
  }

  const actor = await resolveClanActor(clanId, session.user.steamId);
  if (!actor || !canGrantClanVip(actor.member.role)) {
    return NextResponse.json(
      { error: "VIP выдаёт только глава или зам клана" },
      { status: 403 }
    );
  }

  const body = (await req.json().catch(() => null)) as {
    memberId?: string;
    steamId?: string;
  } | null;
  const memberId = String(body?.memberId || "").trim();
  const steamRaw = String(body?.steamId || "").trim();

  const target = memberId
    ? await prisma.clanMember.findFirst({
        where: { id: memberId, clanId },
        include: {
          user: {
            select: {
              id: true,
              nick: true,
              name: true,
              steamName: true,
              steamId: true,
            },
          },
        },
      })
    : steamRaw
      ? await prisma.clanMember.findFirst({
          where: { clanId, user: { steamId: steamRaw } },
          include: {
            user: {
              select: {
                id: true,
                nick: true,
                name: true,
                steamName: true,
                steamId: true,
              },
            },
          },
        })
      : null;

  if (!target?.user?.steamId) {
    return NextResponse.json(
      { error: "Игрок не в этом клане или нет Steam ID" },
      { status: 404 }
    );
  }

  const byNick =
    String(session.user.nick || session.user.name || actor.user.nick || "глава")
      .trim()
      .slice(0, 32) || "глава";
  const note = `клан [${clan.tag}] · ${byNick}`;

  const res = await grantPublicVip({
    steamId: target.user.steamId,
    nick: personLabel(target.user),
    startsAt: new Date(),
    endsAt: null,
    forever: true,
    byNick,
    bySteamId: session.user.steamId,
    byUserId: actor.user.id,
    note,
  });
  if (!res.ok) {
    return NextResponse.json({ error: res.error }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    reply: `VIP выдан ${personLabel(target.user)}`,
    steamId: target.user.steamId,
    memberId: target.id,
  });
}
