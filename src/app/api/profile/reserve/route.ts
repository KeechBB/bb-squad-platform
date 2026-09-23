import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseFutureOrTodayDate } from "@/lib/validation";
import { enterReserve, exitReserve } from "@/lib/reserve";

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
    select: {
      id: true,
      nick: true,
      name: true,
      steamName: true,
      steamId: true,
    },
  });
  if (!me) {
    return NextResponse.json({ error: "Не найден" }, { status: 404 });
  }

  const { user } = await enterReserve({
    userId: me.id,
    until,
    reason,
    source: "self",
    actor: me,
  });

  return NextResponse.json({ ok: true, reserve: user });
}

export async function DELETE() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.steamId) {
    return NextResponse.json({ error: "Нужен вход" }, { status: 401 });
  }

  const me = await prisma.user.findUnique({
    where: { steamId: session.user.steamId },
    select: {
      id: true,
      nick: true,
      name: true,
      steamName: true,
      steamId: true,
    },
  });
  if (!me) {
    return NextResponse.json({ error: "Не найден" }, { status: 404 });
  }

  const { user } = await exitReserve({
    userId: me.id,
    source: "self",
    actor: me,
  });

  return NextResponse.json({ ok: true, reserve: user });
}
