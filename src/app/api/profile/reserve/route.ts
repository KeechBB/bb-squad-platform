import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatRuDate, isActiveReserve, parseFutureOrTodayDate } from "@/lib/validation";
import { exitReserve } from "@/lib/reserve";
import { inclusiveCalendarDays, RESERVE_MIN_DAYS } from "@/lib/absenceDays";
import {
  ABSENCE_REASON_OTHER,
  ABSENCE_REASON_PRESETS,
} from "@/lib/absenceReasons";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PRESETS = new Set<string>(ABSENCE_REASON_PRESETS);

async function meBySteam(steamId: string) {
  return prisma.user.findUnique({
    where: { steamId },
    select: {
      id: true,
      nick: true,
      name: true,
      steamName: true,
      steamId: true,
      reserveUntil: true,
    },
  });
}

function packPending(row: {
  id: string;
  fromAt: Date;
  untilAt: Date;
  reasonKey: string;
  reasonText: string;
  createdAt: Date;
}) {
  return {
    id: row.id,
    fromAt: row.fromAt.toISOString(),
    untilAt: row.untilAt.toISOString(),
    fromLabel: formatRuDate(row.fromAt),
    untilLabel: formatRuDate(row.untilAt),
    reasonKey: row.reasonKey,
    reasonText: row.reasonText,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Своя заявка, если она ещё ждёт решения. */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.steamId || !session.user.profileComplete) {
    return NextResponse.json({ error: "Нужен полный профиль" }, { status: 401 });
  }
  const me = await meBySteam(session.user.steamId);
  if (!me) return NextResponse.json({ error: "Не найден" }, { status: 404 });
  const pending = await prisma.reserveRequest.findFirst({
    where: { userId: me.id, status: "PENDING" },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ pending: pending ? packPending(pending) : null });
}

/** Заявка на резерв. В резерв человек попадает только после принятия в админке. */
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.steamId || !session.user.profileComplete) {
    return NextResponse.json({ error: "Нужен полный профиль" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as {
    from?: string;
    until?: string;
    reasonKey?: string;
    reasonText?: string;
    reason?: string;
  } | null;
  const fromRaw = String(body?.from || "").trim();
  const untilRaw = String(body?.until || "").trim();
  const keyRaw = String(body?.reasonKey || body?.reason || "").trim();
  const textRaw = String(body?.reasonText || body?.reason || "").trim();

  const from = parseFutureOrTodayDate(fromRaw || untilRaw);
  const until = parseFutureOrTodayDate(untilRaw);
  if (!from || !until || until.getTime() < from.getTime()) {
    return NextResponse.json(
      { error: "Укажи даты от и до. Начало не в прошлом, конец не раньше начала." },
      { status: 400 }
    );
  }
  const days = inclusiveCalendarDays(from, until);
  if (days < RESERVE_MIN_DAYS) {
    return NextResponse.json(
      { error: `Резерв — от ${RESERVE_MIN_DAYS} дней. На 1–3 дня бери выходной` },
      { status: 400 }
    );
  }

  const reasonKey = PRESETS.has(keyRaw) ? keyRaw : ABSENCE_REASON_OTHER;
  const reasonText =
    reasonKey === ABSENCE_REASON_OTHER ? textRaw : reasonKey;
  if (reasonKey === ABSENCE_REASON_OTHER && (reasonText.length < 3 || reasonText.length > 300)) {
    return NextResponse.json(
      { error: "Своя причина: от 3 до 300 символов" },
      { status: 400 }
    );
  }

  const me = await meBySteam(session.user.steamId!);
  if (!me) return NextResponse.json({ error: "Не найден" }, { status: 404 });
  if (isActiveReserve(me.reserveUntil)) {
    return NextResponse.json({ error: "Ты уже в резерве" }, { status: 400 });
  }
  const existing = await prisma.reserveRequest.findFirst({
    where: { userId: me.id, status: "PENDING" },
    select: { id: true },
  });
  if (existing) {
    return NextResponse.json(
      { error: "Заявка уже на рассмотрении" },
      { status: 409 }
    );
  }

  const row = await prisma.reserveRequest.create({
    data: {
      userId: me.id,
      fromAt: from,
      untilAt: until,
      reasonKey,
      reasonText,
    },
  });
  return NextResponse.json({ ok: true, pending: packPending(row) });
}

export async function DELETE() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.steamId) {
    return NextResponse.json({ error: "Нужен вход" }, { status: 401 });
  }

  const me = await meBySteam(session.user.steamId);
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
