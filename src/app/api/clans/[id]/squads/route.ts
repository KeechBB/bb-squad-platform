import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canManageClanMembers, canDeleteClanSquad, type ClanRole } from "@/lib/clan";
import { ensureDefaultSquads } from "@/lib/squads";
import {
  BB_STACK_COMMAND,
  computeBbStackFrequency,
  removeDepartedBlackberryMembers,
  syncBbSquadsFromKv,
} from "@/lib/bbStackAuto";
import { computeCwTuByNick } from "@/lib/kvStats";
import { loadTierIndex } from "@/lib/loadTierIndex";
import { canAssignClanSquadMembers } from "@/lib/titles";
import { clanLiveChannel, livePublish } from "@/lib/liveBus";
import { personLabel, writeActionLog } from "@/lib/actionLog";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

async function loadClan(clanId: string) {
  return prisma.clan.findUnique({
    where: { id: clanId },
    select: { id: true, tag: true, name: true },
  });
}

function isBbClan(tag: string, name: string): boolean {
  const t = tag.trim().toLowerCase();
  const n = name.trim().toLowerCase();
  return t === "bb" || n === "blackberry";
}

async function actorMembership(clanId: string, steamId: string) {
  const user = await prisma.user.findUnique({ where: { steamId } });
  if (!user) return null;
  const member = await prisma.clanMember.findUnique({
    where: { clanId_userId: { clanId, userId: user.id } },
    include: { title: { select: { name: true } } },
  });
  if (!member) return null;
  return { user, member };
}

export async function GET(_req: Request, ctx: Ctx) {
  const { id: clanId } = await ctx.params;
  await ensureDefaultSquads(clanId);
  const clan = await loadClan(clanId);
  const bbAuto = clan ? isBbClan(clan.tag, clan.name) : false;
  if (bbAuto) await removeDepartedBlackberryMembers(clanId);
  const nickKey = (n: string) => n.trim().toLowerCase().replace(/\s+/g, "");
  const [squads, tuByNick, tierMap, freq, clanMembers] = await Promise.all([
    prisma.clanSquad.findMany({
      where: { clanId },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      include: {
        members: {
          include: {
            user: {
              select: {
                id: true,
                nick: true,
                name: true,
                avatarUrl: true,
                steamName: true,
              },
            },
          },
          orderBy: { joinedAt: "asc" },
        },
      },
    }),
    computeCwTuByNick().catch(() => new Map<string, number>()),
    loadTierIndex(),
    bbAuto
      ? computeBbStackFrequency().catch(() => [])
      : Promise.resolve([]),
    bbAuto
      ? prisma.clanMember.findMany({
          where: { clanId },
          select: {
            user: { select: { id: true, nick: true, steamName: true } },
          },
        })
      : Promise.resolve([]),
  ]);

  const userByNick = new Map<string, string>();
  for (const m of clanMembers) {
    for (const n of [m.user.nick, m.user.steamName]) {
      const key = n ? nickKey(n) : "";
      if (key) userByNick.set(key, m.user.id);
    }
  }

  const played = freq.map((r) => {
    const key = nickKey(r.nick);
    return {
      nick: r.nick,
      main: r.main,
      junior: r.junior,
      total: r.total,
      tier: r.tier,
      stack: r.stack,
      tu: tuByNick.get(key) ?? null,
      userId: userByNick.get(key) ?? null,
    };
  });

  const enriched = squads.map((s) => ({
    ...s,
    members: s.members.map((m) => {
      const nick = (m.user.nick || m.user.steamName || "").trim();
      const key = nickKey(nick);
      const tier = tierMap.get(key) ?? (nick ? 4 : null);
      const tu = key ? tuByNick.get(key) ?? null : null;
      return { ...m, tier, tu };
    }),
  }));

  return NextResponse.json({
    squads: enriched,
    autoStacks: bbAuto,
    command: bbAuto ? BB_STACK_COMMAND : null,
    played,
  });
}

export async function POST(req: Request, ctx: Ctx) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.steamId) {
    return NextResponse.json({ error: "Нужен вход" }, { status: 401 });
  }
  const { id: clanId } = await ctx.params;
  const actor = await actorMembership(clanId, session.user.steamId);
  if (!actor || !canManageClanMembers(actor.member.role as ClanRole)) {
    return NextResponse.json({ error: "Нет прав" }, { status: 403 });
  }

  const clan = await loadClan(clanId);
  const body = await req.json().catch(() => null);

  // BB: ручные составы закрыты — только авто-синк по КВ (глава/зам)
  if (clan && isBbClan(clan.tag, clan.name)) {
    const action = String((body as { action?: string })?.action || "");
    if (action === "sync") {
      const res = await syncBbSquadsFromKv();
      livePublish(clanLiveChannel(clanId), JSON.stringify({ type: "squad" }));
      return NextResponse.json(res, { status: res.ok ? 200 : 500 });
    }
    return NextResponse.json(
      {
        error:
          "Составы BlackBerry собираются автоматически по КВ. Ручное создание отключено.",
      },
      { status: 403 }
    );
  }

  const name = String((body as { name?: string })?.name || "").trim();
  if (name.length < 2 || name.length > 24) {
    return NextResponse.json({ error: "Название состава: 2–24 символа" }, { status: 400 });
  }

  const count = await prisma.clanSquad.count({ where: { clanId } });
  try {
    const squad = await prisma.clanSquad.create({
      data: { clanId, name, sortOrder: count + 10 },
      include: { members: true },
    });
    livePublish(clanLiveChannel(clanId), JSON.stringify({ type: "squad" }));
    return NextResponse.json({ ok: true, squad });
  } catch {
    return NextResponse.json({ error: "Такой состав уже есть" }, { status: 409 });
  }
}

export async function PATCH(req: Request, ctx: Ctx) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.steamId) {
    return NextResponse.json({ error: "Нужен вход" }, { status: 401 });
  }
  const { id: clanId } = await ctx.params;
  const actor = await actorMembership(clanId, session.user.steamId);
  if (
    !actor ||
    !canAssignClanSquadMembers(
      actor.member.role as ClanRole,
      actor.member.title?.name
    )
  ) {
    return NextResponse.json({ error: "Нет прав" }, { status: 403 });
  }

  const clan = await loadClan(clanId);
  if (clan && isBbClan(clan.tag, clan.name)) {
    return NextResponse.json(
      {
        error:
          "Составы BlackBerry регулируются автоматически после каждой КВ. Ручное добавление отключено.",
      },
      { status: 403 }
    );
  }

  const body = await req.json().catch(() => null);
  const squadId = String((body as { squadId?: string })?.squadId || "");
  const userId = String((body as { userId?: string })?.userId || "");
  const action = String((body as { action?: string })?.action || "");

  if (!squadId || !userId || (action !== "add" && action !== "remove")) {
    return NextResponse.json({ error: "Некорректный запрос" }, { status: 400 });
  }

  const squad = await prisma.clanSquad.findFirst({ where: { id: squadId, clanId } });
  if (!squad) {
    return NextResponse.json({ error: "Состав не найден" }, { status: 404 });
  }

  const inClan = await prisma.clanMember.findUnique({
    where: { clanId_userId: { clanId, userId } },
  });
  if (!inClan) {
    return NextResponse.json({ error: "Игрок не в клане" }, { status: 400 });
  }

  if (action === "remove") {
    const target = await prisma.user.findUnique({
      where: { id: userId },
      select: { nick: true, name: true, steamName: true },
    });
    await prisma.clanSquadMember.deleteMany({ where: { squadId, userId } });
    await writeActionLog({
      category: "clan",
      action: "squad_kick",
      message: `${personLabel(actor.user)} убрал ${personLabel(target || {})} из состава «${squad.name}» клана [${clan?.tag || "?"}]`,
      actorId: actor.user.id,
      actorNick: personLabel(actor.user),
      targetId: userId,
      targetNick: personLabel(target || {}),
      clanId,
      clanTag: clan?.tag,
      meta: { squadId, squadName: squad.name },
    });
    livePublish(clanLiveChannel(clanId), JSON.stringify({ type: "squad" }));
    return NextResponse.json({ ok: true });
  }

  // один состав на клан: убрать из других составов этого клана
  const other = await prisma.clanSquad.findMany({
    where: { clanId, NOT: { id: squadId } },
    select: { id: true },
  });
  if (other.length) {
    await prisma.clanSquadMember.deleteMany({
      where: {
        userId,
        squadId: { in: other.map((s) => s.id) },
      },
    });
  }

  await prisma.clanSquadMember.upsert({
    where: { squadId_userId: { squadId, userId } },
    create: { squadId, userId },
    update: {},
  });

  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { nick: true, name: true, steamName: true },
  });
  await writeActionLog({
    category: "clan",
    action: "squad_add",
    message: `${personLabel(actor.user)} добавил ${personLabel(target || {})} в состав «${squad.name}» [${clan?.tag || "?"}]`,
    actorId: actor.user.id,
    actorNick: personLabel(actor.user),
    targetId: userId,
    targetNick: personLabel(target || {}),
    clanId,
    clanTag: clan?.tag,
    meta: { squadId, squadName: squad.name },
  });

  livePublish(clanLiveChannel(clanId), JSON.stringify({ type: "squad" }));
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request, ctx: Ctx) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.steamId) {
    return NextResponse.json({ error: "Нужен вход" }, { status: 401 });
  }
  const { id: clanId } = await ctx.params;
  const actor = await actorMembership(clanId, session.user.steamId);
  if (
    !actor ||
    !canDeleteClanSquad(actor.member.role as ClanRole)
  ) {
    return NextResponse.json(
      { error: "Удалять составы могут глава и заместитель" },
      { status: 403 }
    );
  }

  const url = new URL(req.url);
  const squadId = url.searchParams.get("squadId") || "";
  const [squad, clan] = await Promise.all([
    prisma.clanSquad.findFirst({ where: { id: squadId, clanId } }),
    loadClan(clanId),
  ]);
  if (!squad) {
    return NextResponse.json({ error: "Состав не найден" }, { status: 404 });
  }
  // Main/Junior нельзя сносить только у BlackBerry (авто-стаки)
  if (
    clan &&
    isBbClan(clan.tag, clan.name) &&
    ["main", "junior"].includes(squad.name.toLowerCase())
  ) {
    return NextResponse.json(
      { error: "Main и Junior нельзя удалить" },
      { status: 403 }
    );
  }

  await prisma.clanSquad.delete({ where: { id: squadId } });
  livePublish(clanLiveChannel(clanId), JSON.stringify({ type: "squad" }));
  return NextResponse.json({ ok: true });
}
