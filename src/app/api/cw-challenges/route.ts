import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canManageCwChallenges, type ClanRole } from "@/lib/clan";
import { CW_SERVER_POOL_NOTE, isCwFormat, isCwMode } from "@/lib/cwChallenge";
import { getUserClanMembership } from "@/lib/clanAccess";

export const dynamic = "force-dynamic";

/** Список открытых заявок + свои (для вкладки «Регистрация»). */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.steamId || !session.user.profileComplete) {
    return NextResponse.json({ error: "Нужен вход" }, { status: 401 });
  }

  const rows = await prisma.cwChallenge.findMany({
    where: { status: { in: ["OPEN", "ACCEPTED"] } },
    orderBy: [{ status: "asc" }, { scheduledAt: "asc" }],
    include: {
      challengerClan: { select: { id: true, tag: true, name: true, logoUrl: true } },
      acceptorClan: { select: { id: true, tag: true, name: true, logoUrl: true } },
      createdBy: { select: { nick: true } },
    },
    take: 100,
  });

  const mine = await getUserClanMembership(session.user.steamId);

  return NextResponse.json({
    ok: true,
    serverPoolNote: CW_SERVER_POOL_NOTE,
    myClanId: mine?.membership.clanId ?? null,
    canManage: mine
      ? canManageCwChallenges(mine.membership.role as ClanRole)
      : false,
    challenges: rows.map((r) => ({
      id: r.id,
      mode: r.mode,
      format: r.format,
      scheduledAt: r.scheduledAt.toISOString(),
      createdAt: r.createdAt.toISOString(),
      assignedServer: r.assignedServer,
      status: r.status,
      challenger: r.challengerClan,
      acceptor: r.acceptorClan,
      createdByNick: r.createdBy.nick,
    })),
  });
}

/** Создать заявку на КВ (глава / зам своего клана). */
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.steamId || !session.user.profileComplete) {
    return NextResponse.json({ error: "Нужен вход" }, { status: 401 });
  }

  const mine = await getUserClanMembership(session.user.steamId);
  if (!mine) {
    return NextResponse.json(
      { error: "Сначала вступите в клан" },
      { status: 403 }
    );
  }
  if (!canManageCwChallenges(mine.membership.role as ClanRole)) {
    return NextResponse.json(
      { error: "Создавать заявку могут только глава или зам" },
      { status: 403 }
    );
  }
  if (mine.membership.clan.isExternal) {
    return NextResponse.json(
      { error: "Внешний клан не может создавать заявки" },
      { status: 403 }
    );
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Некорректные данные" }, { status: 400 });
  }

  const mode = String((body as { mode?: string }).mode || "").toUpperCase();
  const format = Number((body as { format?: number }).format);
  const scheduledRaw = String((body as { scheduledAt?: string }).scheduledAt || "").trim();

  if (!isCwMode(mode)) {
    return NextResponse.json(
      { error: "Мод: Hotdrop / CSL / FCL / SEC" },
      { status: 400 }
    );
  }
  if (!Number.isInteger(format) || !isCwFormat(format)) {
    return NextResponse.json(
      { error: "Формат: 8vs8 / 16vs16 / 20vs20 / 26vs26 / 30vs30 / 36vs36" },
      { status: 400 }
    );
  }

  // ISO или datetime-local (YYYY-MM-DDTHH:mm) как МСК → UTC
  let scheduledAt: Date | null = null;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(scheduledRaw)) {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(scheduledRaw);
    if (m) {
      const y = Number(m[1]);
      const mo = Number(m[2]);
      const d = Number(m[3]);
      const hh = Number(m[4]);
      const mm = Number(m[5]);
      // Europe/Moscow = UTC+3 (без DST)
      scheduledAt = new Date(Date.UTC(y, mo - 1, d, hh - 3, mm, 0));
    }
  } else if (scheduledRaw) {
    const t = Date.parse(scheduledRaw);
    if (!Number.isNaN(t)) scheduledAt = new Date(t);
  }
  if (!scheduledAt || Number.isNaN(scheduledAt.getTime())) {
    return NextResponse.json(
      { error: "Укажите дату и время (МСК)" },
      { status: 400 }
    );
  }
  if (scheduledAt.getTime() < Date.now() - 60_000) {
    return NextResponse.json(
      { error: "Дата/время не должны быть в прошлом" },
      { status: 400 }
    );
  }

  const created = await prisma.cwChallenge.create({
    data: {
      challengerClanId: mine.membership.clanId,
      mode,
      format,
      scheduledAt,
      createdById: mine.userId,
      status: "OPEN",
    },
    include: {
      challengerClan: { select: { id: true, tag: true, name: true } },
    },
  });

  return NextResponse.json({
    ok: true,
    challenge: {
      id: created.id,
      mode: created.mode,
      format: created.format,
      scheduledAt: created.scheduledAt.toISOString(),
      status: created.status,
      challenger: created.challengerClan,
    },
    serverPoolNote: CW_SERVER_POOL_NOTE,
  });
}
