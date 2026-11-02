import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getUserRole } from "@/lib/admin";
import {
  canReplySupport,
  isSupportTopic,
  SUPPORT_DISPLAY_NAME,
  SUPPORT_WELCOME,
  supportTopicLabel,
} from "@/lib/support";
import {
  afterUserSupportMessage,
  pickSupportAgentName,
  supportIntro,
} from "@/lib/supportAgent";
import {
  livePublish,
  livePublishSupportStaff,
  userLiveChannel,
} from "@/lib/liveBus";
import { personLabel, writeActionLog } from "@/lib/actionLog";
import { alertSupportTicket } from "@/lib/bbAlerts";

export const dynamic = "force-dynamic";

function publicMessage(
  m: {
    id: string;
    kind: string;
    body: string;
    createdAt: Date;
    author: { nick: string | null; steamName: string | null } | null;
  },
  viewer: "user" | "staff",
  agentName?: string | null
) {
  let from = agentName || SUPPORT_DISPLAY_NAME;
  if (m.kind === "USER") {
    from = m.author?.nick || m.author?.steamName || "Игрок";
  } else if (m.kind === "STAFF") {
    from =
      viewer === "staff"
        ? m.author?.nick || m.author?.steamName || SUPPORT_DISPLAY_NAME
        : SUPPORT_DISPLAY_NAME;
  } else if (m.kind === "BOT") {
    from = agentName || SUPPORT_DISPLAY_NAME;
  }
  return {
    id: m.id,
    kind: m.kind,
    body: m.body,
    from,
    createdAt: m.createdAt.toISOString(),
  };
}

function packTicket(
  ticket: {
    id: string;
    number: number;
    status: string;
    topic: string | null;
    agentName: string | null;
    user: { nick: string | null; steamName: string | null };
    messages: Array<{
      id: string;
      kind: string;
      body: string;
      createdAt: Date;
      author: { nick: string | null; steamName: string | null } | null;
    }>;
  },
  viewer: "user" | "staff"
) {
  return {
    id: ticket.id,
    number: ticket.number,
    status: ticket.status,
    topic: ticket.topic,
    topicLabel: supportTopicLabel(ticket.topic),
    agentName: ticket.agentName,
    userNick: ticket.user.nick || ticket.user.steamName || "Игрок",
    messages: ticket.messages.map((m) =>
      publicMessage(m, viewer, ticket.agentName)
    ),
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
    topicLabel: string;
  }> = [];

  if (staff) {
    const open = await prisma.supportTicket.findMany({
      where: {
        status: "OPEN",
        messages: { some: { kind: "USER" } },
      },
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
      topicLabel: supportTopicLabel(t.topic),
      preview: t.messages[0]?.body?.slice(0, 80) || "",
      waiting: t.needsOperator && t._count.messages === 0,
    }));
  }

  const viewer = staff ? "staff" : "user";
  return NextResponse.json({
    ok: true,
    staff,
    welcome: SUPPORT_WELCOME,
    myNick: user.nick || user.steamName || "Игрок",
    ticket: mine ? packTicket(mine, viewer) : null,
    inbox,
  });
}

/** Создать тикет с первым сообщением (без текста — нельзя). */
export async function POST(req: Request) {
  const user = await me();
  if (!user) {
    return NextResponse.json({ ok: false, error: "auth" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    text?: string;
    topic?: string;
  };
  const text = String(body.text || "").trim().slice(0, 2000);
  const topicRaw = String(body.topic || "").trim();

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

  if (existing && !text) {
    return NextResponse.json({
      ok: true,
      created: false,
      ticket: packTicket(existing, "user"),
    });
  }

  if (!existing && isSupportTopic(topicRaw) && !text) {
    const agentName = pickSupportAgentName();
    const ticket = await prisma.supportTicket.create({
      data: {
        userId: user.id,
        topic: topicRaw,
        agentName,
        messages: {
          create: [{ kind: "BOT", body: supportIntro(topicRaw, agentName) }],
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
    const nick = personLabel(user);
    await writeActionLog({
      category: "support",
      action: "ticket_open",
      message: `${nick} открыл тикет #${ticket.number} (${supportTopicLabel(topicRaw)})`,
      actorId: user.id,
      actorNick: nick,
      targetId: user.id,
      targetNick: nick,
      meta: {
        ticketId: ticket.id,
        ticketNumber: ticket.number,
        topic: topicRaw,
        agentName,
      },
    });
    return NextResponse.json({
      ok: true,
      created: true,
      ticket: packTicket(ticket, "user"),
    });
  }

  if (!text) {
    return NextResponse.json(
      { ok: false, error: "topic", message: "Сначала выберите тему тикета" },
      { status: 400 }
    );
  }

  if (!existing) {
    return NextResponse.json(
      { ok: false, error: "topic", message: "Сначала выберите тему тикета" },
      { status: 400 }
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.supportTicket.update({
      where: { id: existing.id },
      data: { updatedAt: new Date() },
    });
    await tx.supportMessage.create({
      data: {
        ticketId: existing.id,
        kind: "USER",
        authorId: user.id,
        body: text,
      },
    });
  });

  const follow = await afterUserSupportMessage({ ticketId: existing.id });
  const ticket = await prisma.supportTicket.findUniqueOrThrow({
    where: { id: existing.id },
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

  const nick = personLabel(user);
  const preview = text.length > 280 ? `${text.slice(0, 280)}…` : text;
  await writeActionLog({
    category: "support",
    action: "ticket_message",
    message: `${nick} написал в тикете #${ticket.number}: «${preview}»`,
    actorId: user.id,
    actorNick: nick,
    targetId: user.id,
    targetNick: nick,
    meta: {
      ticketId: ticket.id,
      ticketNumber: ticket.number,
      kind: "USER",
      body: text,
    },
  });
  if (follow.alert) {
    void alertSupportTicket({ number: ticket.number, nick, preview }).catch((err) => {
      console.error("telegram ticket alert failed", err);
    });
  }

  livePublishSupportStaff({ type: "message", ticketId: ticket.id });
  livePublish(
    userLiveChannel(user.id),
    JSON.stringify({ type: "support", ticketId: ticket.id })
  );

  return NextResponse.json({
    ok: true,
    created: false,
    ticket: packTicket(ticket, "user"),
  });
}
