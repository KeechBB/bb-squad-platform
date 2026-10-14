import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseFutureOrTodayDate } from "@/lib/validation";
import { enterDayOff, exitDayOff } from "@/lib/dayOff";
import { DAY_OFF_MAX_DAYS, DAY_OFF_MIN_DAYS } from "@/lib/absenceDays";

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
        error: `Укажи дату конца выходного (ДД.ММ.ГГГГ, не в прошлом). Выходной: ${DAY_OFF_MIN_DAYS}–${DAY_OFF_MAX_DAYS} дня`,
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

  try {
    const { user } = await enterDayOff({
      userId: me.id,
      until,
      reason,
      source: "self",
      actor: me,
    });
    return NextResponse.json({ ok: true, dayOff: user });
  } catch (e) {
    if (e instanceof Error && e.message === "day_off_range") {
      return NextResponse.json(
        {
          error: `Выходной — от ${DAY_OFF_MIN_DAYS} до ${DAY_OFF_MAX_DAYS} дней включительно. Дольше — в резерв`,
        },
        { status: 400 }
      );
    }
    throw e;
  }
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

  const { user } = await exitDayOff({
    userId: me.id,
    source: "self",
    actor: me,
  });

  return NextResponse.json({ ok: true, dayOff: user });
}
