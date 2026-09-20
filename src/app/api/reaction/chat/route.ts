import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  REACTION_CHAT_MAX_LEN,
  reactionChatWindowStart,
} from "@/lib/reaction";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function purgeOld(windowStart: Date) {
  await prisma.reactionChatMessage.deleteMany({
    where: { createdAt: { lt: windowStart } },
  });
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.steamId || !session.user.profileComplete) {
    return NextResponse.json({ error: "Нужен вход" }, { status: 401 });
  }

  const windowStart = reactionChatWindowStart();
  await purgeOld(windowStart);

  const rows = await prisma.reactionChatMessage.findMany({
    where: { createdAt: { gte: windowStart } },
    orderBy: { createdAt: "asc" },
    take: 80,
    include: {
      user: { select: { nick: true, steamName: true } },
    },
  });

  return NextResponse.json({
    ok: true,
    windowStart: windowStart.toISOString(),
    windowEndsAt: new Date(
      windowStart.getTime() + 30 * 60 * 1000
    ).toISOString(),
    messages: rows.map((m) => ({
      id: m.id,
      text: m.text,
      createdAt: m.createdAt.toISOString(),
      nick: m.user.nick || m.user.steamName || "Игрок",
      userId: m.userId,
    })),
  });
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.steamId || !session.user.profileComplete) {
    return NextResponse.json({ error: "Нужен вход" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { steamId: session.user.steamId },
    select: { id: true, nick: true, steamName: true },
  });
  if (!user) {
    return NextResponse.json({ error: "Не найден" }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const raw = typeof body?.text === "string" ? body.text : "";
  const text = raw.replace(/\s+/g, " ").trim().slice(0, REACTION_CHAT_MAX_LEN);
  if (!text) {
    return NextResponse.json({ error: "Пустое сообщение" }, { status: 400 });
  }

  const windowStart = reactionChatWindowStart();
  await purgeOld(windowStart);

  const msg = await prisma.reactionChatMessage.create({
    data: { userId: user.id, text },
  });

  return NextResponse.json({
    ok: true,
    message: {
      id: msg.id,
      text: msg.text,
      createdAt: msg.createdAt.toISOString(),
      nick: user.nick || user.steamName || "Игрок",
      userId: user.id,
    },
  });
}
