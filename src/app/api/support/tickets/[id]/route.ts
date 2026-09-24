import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getUserRole } from "@/lib/admin";
import {
  canReplySupport,
  SUPPORT_DISPLAY_NAME,
} from "@/lib/support";
import {
  livePublish,
  livePublishSupportStaff,
  supportTicketChannel,
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
    select: {
      id: true,
      nick: true,
      steamName: true,
      steamId: true,
    },
  });
  if (!user) return null;
  const role = await getUserRole(user.steamId);
  return { ...user, role };
}

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const user = await me();
  if (!user) {
    return NextResponse.json({ ok: false, error: "auth" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const staff = canReplySupport(user.role);
  const ticket = await prisma.supportTicket.findUnique({
    where: { id },
    include: {
      messages: {
        orderBy: { createdAt: "asc" },
        include: {
          author: { select: { nick: true, steamName: true } },
        },
      },
      user: { select: { nick: true, steamName: true, id: true } },
    },
  });
  if (!ticket || ticket.status !== "OPEN") {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }
  if (!staff && ticket.userId !== user.id) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }
  const viewer = staff ? "staff" : "user";
  return NextResponse.json({
    ok: true,
    ticket: {
      id: ticket.id,
      number: ticket.number,
      status: ticket.status,
      userNick: ticket.user.nick || ticket.user.steamName || "Игрок",
      messages: ticket.messages.map((m) => publicMessage(m, viewer)),
    },
  });
}

/** Отправить сообщение */
export async function POST(req: Request, ctx: Ctx) {
  const user = await me();
  if (!user) {
    return NextResponse.json({ ok: false, error: "auth" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { text?: string };
  const text = String(body.text || "").trim().slice(0, 2000);
  if (!text) {
    return NextResponse.json({ ok: false, error: "empty" }, { status: 400 });
  }

  const staff = canReplySupport(user.role);
  const ticket = await prisma.supportTicket.findUnique({ where: { id } });
  if (!ticket || ticket.status !== "OPEN") {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }

  const isOwner = ticket.userId === user.id;
  if (!isOwner && !staff) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  // Владелец пишет как USER; стафф в чужой тикет — как STAFF (имя наружу «Тех. поддержка»).
  const msgKind = isOwner ? "USER" : "STAFF";

  const msg = await prisma.$transaction(async (tx) => {
    if (msgKind === "STAFF" && !ticket.claimedById) {
      await tx.supportTicket.update({
        where: { id },
        data: { claimedById: user.id, updatedAt: new Date() },
      });
    } else {
      await tx.supportTicket.update({
        where: { id },
        data: { updatedAt: new Date() },
      });
    }
    return tx.supportMessage.create({
      data: {
        ticketId: id,
        kind: msgKind,
        authorId: user.id,
        body: text,
      },
      include: {
        author: { select: { nick: true, steamName: true } },
      },
    });
  });

  livePublish(
    supportTicketChannel(id),
    JSON.stringify({ type: "message", ticketId: id })
  );
  livePublish(
    userLiveChannel(ticket.userId),
    JSON.stringify({ type: "support", ticketId: id })
  );
  livePublishSupportStaff({ type: "message", ticketId: id });

  const viewer = staff ? "staff" : "user";
  return NextResponse.json({
    ok: true,
    message: publicMessage(msg, isOwner ? "user" : viewer),
  });
}

/** Завершить тикет — история удаляется */
export async function DELETE(_req: Request, ctx: Ctx) {
  const user = await me();
  if (!user) {
    return NextResponse.json({ ok: false, error: "auth" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const staff = canReplySupport(user.role);
  const ticket = await prisma.supportTicket.findUnique({ where: { id } });
  if (!ticket) {
    return NextResponse.json({ ok: true, deleted: false });
  }
  if (ticket.userId !== user.id && !staff) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const ownerId = ticket.userId;
  await prisma.supportTicket.delete({ where: { id } });

  livePublish(
    userLiveChannel(ownerId),
    JSON.stringify({ type: "support", ticketId: id, closed: true })
  );
  livePublishSupportStaff({ type: "closed", ticketId: id });

  return NextResponse.json({ ok: true, deleted: true });
}
