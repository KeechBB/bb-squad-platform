import type { ClanRole, User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { personLabel, writeActionLog } from "@/lib/actionLog";
import { clanLiveChannel, livePublish, userLiveChannel } from "@/lib/liveBus";
import { formatRuDate, isActiveReserve } from "@/lib/validation";

export type ReserveActor = {
  id: string;
  nick?: string | null;
  name?: string | null;
  steamName?: string | null;
  steamId?: string | null;
};

export async function enterReserve(opts: {
  userId: string;
  until: Date;
  reason: string;
  source: "self" | "admin";
  actor: ReserveActor;
}) {
  const me = await prisma.user.findUnique({
    where: { id: opts.userId },
    include: { clanMemberships: true },
  });
  if (!me) throw new Error("user_not_found");

  // Закрыть висящий stint, если был
  await prisma.reserveStint.updateMany({
    where: { userId: me.id, exitedAt: null },
    data: {
      exitedAt: new Date(),
      exitedById: opts.actor.id,
    },
  });

  const user = await prisma.user.update({
    where: { id: me.id },
    data: { reserveUntil: opts.until, reserveReason: opts.reason },
    select: {
      id: true,
      nick: true,
      name: true,
      steamName: true,
      steamId: true,
      reserveUntil: true,
      reserveReason: true,
    },
  });

  const stint = await prisma.reserveStint.create({
    data: {
      userId: me.id,
      untilAt: opts.until,
      reason: opts.reason,
      source: opts.source,
      enteredById: opts.actor.id,
    },
  });

  for (const m of me.clanMemberships) {
    if (m.role === "LEADER") continue;
    if (m.role === "RESERVE" && m.roleBeforeReserve) continue;
    await prisma.clanMember.update({
      where: { id: m.id },
      data: {
        roleBeforeReserve: m.role as ClanRole,
        role: "RESERVE",
      },
    });
    livePublish(
      clanLiveChannel(m.clanId),
      JSON.stringify({ type: "reserve", userId: me.id })
    );
  }

  livePublish(userLiveChannel(me.id), JSON.stringify({ type: "reserve" }));

  const target = personLabel(user);
  const actor = personLabel(opts.actor);
  const untilLabel = formatRuDate(opts.until);
  const msg =
    opts.source === "admin"
      ? `${actor} отправил ${target} в резерв до ${untilLabel} (причина: ${opts.reason})`
      : `${target} ушёл в резерв до ${untilLabel} (причина: ${opts.reason})`;

  await writeActionLog({
    category: opts.source === "admin" ? "admin" : "profile",
    action: "reserve_enter",
    message: msg,
    actorId: opts.actor.id,
    actorNick: actor,
    targetId: me.id,
    targetNick: target,
    meta: {
      until: opts.until.toISOString(),
      reason: opts.reason,
      source: opts.source,
      stintId: stint.id,
    },
  });

  return { user, stint };
}

export async function exitReserve(opts: {
  userId: string;
  source: "self" | "admin";
  actor: ReserveActor;
}) {
  const me = await prisma.user.findUnique({
    where: { id: opts.userId },
    include: { clanMemberships: true },
  });
  if (!me) throw new Error("user_not_found");

  const user = await prisma.user.update({
    where: { id: me.id },
    data: { reserveUntil: null, reserveReason: null },
    select: {
      id: true,
      nick: true,
      name: true,
      steamName: true,
      steamId: true,
      reserveUntil: true,
      reserveReason: true,
    },
  });

  await prisma.reserveStint.updateMany({
    where: { userId: me.id, exitedAt: null },
    data: {
      exitedAt: new Date(),
      exitedById: opts.actor.id,
    },
  });

  for (const m of me.clanMemberships) {
    if (m.role !== "RESERVE") continue;
    const restore = (m.roleBeforeReserve || "MEMBER") as ClanRole;
    await prisma.clanMember.update({
      where: { id: m.id },
      data: {
        role: restore === "LEADER" ? "MEMBER" : restore,
        roleBeforeReserve: null,
      },
    });
    livePublish(
      clanLiveChannel(m.clanId),
      JSON.stringify({ type: "reserve-exit", userId: me.id })
    );
  }

  livePublish(userLiveChannel(me.id), JSON.stringify({ type: "reserve" }));

  const target = personLabel(user);
  const actor = personLabel(opts.actor);
  const msg =
    opts.source === "admin"
      ? `${actor} вернул ${target} из резерва`
      : `${target} вернулся из резерва`;

  await writeActionLog({
    category: opts.source === "admin" ? "admin" : "profile",
    action: "reserve_exit",
    message: msg,
    actorId: opts.actor.id,
    actorNick: actor,
    targetId: me.id,
    targetNick: target,
    meta: { source: opts.source },
  });

  return { user };
}

export function userInReserve(u: {
  reserveUntil: Date | null;
}): boolean {
  return isActiveReserve(u.reserveUntil);
}

/** Клан(ы) BlackBerry по тегу/имени */
export async function findBlackberryClanIds(): Promise<string[]> {
  const clans = await prisma.clan.findMany({
    where: {
      OR: [
        { tag: { equals: "BB", mode: "insensitive" } },
        { tag: { equals: "BlackBerry", mode: "insensitive" } },
        { name: { contains: "BlackBerry", mode: "insensitive" } },
        { name: { equals: "BB", mode: "insensitive" } },
      ],
    },
    select: { id: true },
  });
  return clans.map((c) => c.id);
}

export type { User };
