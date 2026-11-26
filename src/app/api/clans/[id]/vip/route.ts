import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  canGrantClanVip,
  clanAllowsVipGrants,
  resolveClanActor,
  type ClanActor,
} from "@/lib/clanActor";
import { grantPublicVip, revokePublicVip } from "@/lib/panelkaVipBan";
import { personLabel } from "@/lib/actionLog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

type ClanVipOk = {
  clan: { id: string; tag: string; name: string };
  actor: ClanActor;
};

async function loadClanVipActor(
  clanId: string,
  steamId: string
): Promise<ClanVipOk | { error: NextResponse }> {
  const clan = await prisma.clan.findUnique({
    where: { id: clanId },
    select: { id: true, tag: true, name: true },
  });
  if (!clan) {
    return { error: NextResponse.json({ error: "Клан не найден" }, { status: 404 }) };
  }
  if (!clanAllowsVipGrants(clan.tag)) {
    return {
      error: NextResponse.json(
        { error: "В этом клане VIP с сайта не выдаётся" },
        { status: 403 }
      ),
    };
  }
  const actor = await resolveClanActor(clanId, steamId);
  if (!actor || !canGrantClanVip(actor.member.role)) {
    return {
      error: NextResponse.json(
        { error: "VIP выдаёт/снимает только глава или зам клана" },
        { status: 403 }
      ),
    };
  }
  return { clan, actor };
}

async function findClanVipTarget(opts: {
  clanId: string;
  memberId?: string;
  steamId?: string;
}) {
  const memberId = String(opts.memberId || "").trim();
  const steamRaw = String(opts.steamId || "").trim();
  const include = {
    user: {
      select: {
        id: true,
        nick: true,
        name: true,
        steamName: true,
        steamId: true,
      },
    },
  } as const;
  if (memberId) {
    return prisma.clanMember.findFirst({
      where: { id: memberId, clanId: opts.clanId },
      include,
    });
  }
  if (steamRaw) {
    return prisma.clanMember.findFirst({
      where: { clanId: opts.clanId, user: { steamId: steamRaw } },
      include,
    });
  }
  return null;
}

/**
 * Глава / зам выдаёт VIP члену клана:
 * QueuePriority — без очереди + balance/teamchange на паблике.
 */
export async function POST(req: Request, ctx: Ctx) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.steamId) {
    return NextResponse.json({ error: "Нужен вход" }, { status: 401 });
  }
  const { id: clanId } = await ctx.params;
  const loaded = await loadClanVipActor(clanId, session.user.steamId);
  if ("error" in loaded) return loaded.error;
  const { clan, actor } = loaded;

  const body = (await req.json().catch(() => null)) as {
    memberId?: string;
    steamId?: string;
  } | null;
  const target = await findClanVipTarget({
    clanId,
    memberId: body?.memberId,
    steamId: body?.steamId,
  });
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

/** Снять VIP (QueuePriority) с члена клана. */
export async function DELETE(req: Request, ctx: Ctx) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.steamId) {
    return NextResponse.json({ error: "Нужен вход" }, { status: 401 });
  }
  const { id: clanId } = await ctx.params;
  const loaded = await loadClanVipActor(clanId, session.user.steamId);
  if ("error" in loaded) return loaded.error;
  const { actor } = loaded;

  const body = (await req.json().catch(() => null)) as {
    memberId?: string;
    steamId?: string;
  } | null;
  const target = await findClanVipTarget({
    clanId,
    memberId: body?.memberId,
    steamId: body?.steamId,
  });
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

  const res = await revokePublicVip({
    steamId: target.user.steamId,
    byNick,
  });
  if (!res.ok) {
    return NextResponse.json({ error: res.error }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    reply: `VIP снят с ${personLabel(target.user)}`,
    steamId: target.user.steamId,
    memberId: target.id,
  });
}
