import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseFutureOrTodayDate } from "@/lib/validation";
import { clanLiveChannel, livePublish, userLiveChannel } from "@/lib/liveBus";
import type { ClanRole } from "@prisma/client";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.steamId || !session.user.profileComplete) {
    return NextResponse.json({ error: "Нужен полный профиль" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const untilRaw = String((body as { until?: string })?.until || "").trim();
  const reason = String((body as { reason?: string })?.reason || "").trim();

  const until = parseFutureOrTodayDate(untilRaw);
  if (!until) {
    return NextResponse.json(
      {
        error:
          "Укажи дату до которой уходишь в резерв (ДД.ММ.ГГГГ, не в прошлом)",
      },
      { status: 400 }
    );
  }
  if (reason.length < 3 || reason.length > 300) {
    return NextResponse.json(
      { error: "Причина: от 3 до 300 символов" },
      { status: 400 }
    );
  }

  const me = await prisma.user.findUnique({
    where: { steamId: session.user.steamId },
    include: { clanMemberships: true },
  });
  if (!me) {
    return NextResponse.json({ error: "Не найден" }, { status: 404 });
  }

  const user = await prisma.user.update({
    where: { id: me.id },
    data: { reserveUntil: until, reserveReason: reason },
    select: { id: true, reserveUntil: true, reserveReason: true },
  });

  // В кланах роль → Резерв (главу не трогаем)
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

  return NextResponse.json({ ok: true, reserve: user });
}

export async function DELETE() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.steamId) {
    return NextResponse.json({ error: "Нужен вход" }, { status: 401 });
  }

  const me = await prisma.user.findUnique({
    where: { steamId: session.user.steamId },
    include: { clanMemberships: true },
  });
  if (!me) {
    return NextResponse.json({ error: "Не найден" }, { status: 404 });
  }

  const user = await prisma.user.update({
    where: { id: me.id },
    data: { reserveUntil: null, reserveReason: null },
    select: { id: true, reserveUntil: true, reserveReason: true },
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

  return NextResponse.json({ ok: true, reserve: user });
}
