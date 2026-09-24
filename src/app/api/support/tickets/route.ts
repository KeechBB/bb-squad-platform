import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getUserRole } from "@/lib/admin";
import {
  canReplySupport,
  SUPPORT_BOT_WAITING,
  SUPPORT_DISPLAY_NAME,
  SUPPORT_WELCOME,
} from "@/lib/support";
import {
  livePublish,
  livePublishSupportStaff,
  userLiveChannel,
} from "@/lib/liveBus";

export const dynamic = "force-dynamic";

function publicMessage(
  m: {
    id: string;
    kind: string;
    body: string;
    createdAt: Date;
    author: { nick: string | null; steamName: string | null } | null;
  },
  viewer: "user" | "staff"
) {
  let from = SUPPORT_DISPLAY_NAME;
  if (m.kind === "USER") {
    from = m.author?.nick || m.author?.steamName || "Игрок";
  } else if (m.kind === "STAFF") {
    from =
      viewer === "staff"
        ? m.author?.nick || m.author?.steamName || SUPPORT_DISPLAY_NAME
        : SUPPORT_DISPLAY_NAME;
  }
  return {
    id: m.id,
    kind: m.kind,
    body: m.body,
    from,
    createdAt: m.createdAt.toISOString(),
  };
}

async function me() {
  const session = await getSession();
  if (!session?.user?.steamId) return null;
  const user = await prisma.user.findUnique({
    where: { steamId: session.user.steamId },
    select: { id: true, nick: true, steamName: true, steamId: true },
  });
  if (!user) return null;
  const role = await getUserRole(user.steamId);
  return { ...user, role };
}

/** Текущий открытый тикет + очередь для стаффа */
export async function GET() {
  const user = await me();
  if (!user) {
    return NextResponse.json({ ok: false, error: "auth" }, { status: 401 });
  }

  const staff = canReplySupport(user.role);
  const mine = await prisma.supportTicket.findFirst({
    where: { userId: user.id, status: "OPEN" },
    include: {
      messages: {
        orderBy: { createdAt: "asc" },
        include: {
          author: { select: { nick: true, steamName: true } },
        },
      },
      user: { select: { nick: true, steamName: true } },
    },
  });

  let inbox: Array<{
    id: string;
    number: number;
    userNick: string;
    updatedAt: string;
    preview: string;
    waiting: boolean;
  }> = [];

  if (staff) {
    const open = await prisma.supportTicket.findMany({
      where: { status: "OPEN" },
      orderBy: { updatedAt: "desc" },
      take: 40,
      include: {
        user: { select: { nick: true, steamName: true } },
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { body: true, kind: true },
        },
        _count: {
          select: {
            messages: { where: { kind: "STAFF" } },
          },
        },
      },
    });
    inbox = open.map((t) => ({
      id: t.id,
      number: t.number,
      userNick: t.user.nick || t.user.steamName || "Игрок",
      updatedAt: t.updatedAt.toISOString(),
      preview: t.messages[0]?.body?.slice(0, 80) || "",
      waiting: t._count.messages === 0,
    }));
  }

  const viewer = staff ? "staff" : "user";
  return NextResponse.json({
    ok: true,
    staff,
    welcome: SUPPORT_WELCOME,
    myNick: user.nick || user.steamName || "Игрок",
    ticket: mine
      ? {
          id: mine.id,
          number: mine.number,
          status: mine.status,
          userNick: mine.user.nick || mine.user.steamName || "Игрок",
          messages: mine.messages.map((m) => publicMessage(m, viewer)),
        }
      : null,
    inbox,
  });
}

/** Создать новый тикет (или вернуть уже открытый) */
export async function POST() {
  const user = await me();
  if (!user) {
    return NextResponse.json({ ok: false, error: "auth" }, { status: 401 });
  }

  const existing = await prisma.supportTicket.findFirst({
    where: { userId: user.id, status: "OPEN" },
    include: {
      messages: {
        orderBy: { createdAt: "asc" },
        include: {
          author: { select: { nick: true, steamName: true } },
        },
      },
      user: { select: { nick: true, steamName: true } },
    },
  });

  if (existing) {
    return NextResponse.json({
      ok: true,
      created: false,
      ticket: {
        id: existing.id,
        number: existing.number,
        status: existing.status,
        userNick: existing.user.nick || existing.user.steamName || "Игрок",
        messages: existing.messages.map((m) => publicMessage(m, "user")),
      },
    });
  }

  const ticket = await prisma.supportTicket.create({
    data: {
      userId: user.id,
      messages: {
        create: {
          kind: "BOT",
          body: SUPPORT_BOT_WAITING,
        },
      },
    },
    include: {
      messages: {
        orderBy: { createdAt: "asc" },
        include: {
          author: { select: { nick: true, steamName: true } },
        },
      },
      user: { select: { nick: true, steamName: true } },
    },
  });

  livePublishSupportStaff({ type: "ticket", ticketId: ticket.id });
  livePublish(
    userLiveChannel(user.id),
    JSON.stringify({ type: "support", ticketId: ticket.id })
  );

  return NextResponse.json({
    ok: true,
    created: true,
    ticket: {
      id: ticket.id,
      number: ticket.number,
      status: ticket.status,
      userNick: ticket.user.nick || ticket.user.steamName || "Игрок",
      messages: ticket.messages.map((m) => publicMessage(m, "user")),
    },
  });
}
