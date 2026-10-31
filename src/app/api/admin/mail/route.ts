import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSiteVisitsAccess } from "@/lib/requireAdmin";
import { recipientIds, resolveSender } from "@/lib/profileMail";
import { cleanMailTags } from "@/lib/mailTags";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const gate = await requireSiteVisitsAccess();
  if (gate.error) return gate.error;
  const url = new URL(req.url);
  const audience = url.searchParams.get("audience") || "";
  if (audience === "clan" || audience === "all") {
    const ids = await recipientIds({ audience, userIds: [] });
    return NextResponse.json({ count: ids.length });
  }
  const q = (url.searchParams.get("q") || "").trim();
  if (q.length < 2) return NextResponse.json({ users: [] });
  const users = await prisma.user.findMany({
    where: {
      OR: [
        { nick: { contains: q, mode: "insensitive" } },
        { steamName: { contains: q, mode: "insensitive" } },
      ],
    },
    select: { id: true, nick: true, steamName: true },
    take: 8,
    orderBy: { nick: "asc" },
  });
  return NextResponse.json({
    users: users.map((u) => ({
      id: u.id,
      nick: u.nick || u.steamName || "без ника",
    })),
  });
}

export async function POST(req: Request) {
  const gate = await requireSiteVisitsAccess();
  if (gate.error) return gate.error;
  const steamId = gate.session?.user?.steamId || "";
  const author = await prisma.user.findUnique({
    where: { steamId },
    select: { id: true },
  });
  if (!author) {
    return NextResponse.json({ error: "Нет профиля" }, { status: 403 });
  }
  const body = (await req.json().catch(() => null)) as {
    title?: string;
    body?: string;
    senderKind?: string;
    senderLabel?: string;
    audience?: string;
    userIds?: string[];
    tags?: string[];
  } | null;
  const title = (body?.title || "").trim().slice(0, 140);
  const text = (body?.body || "").trim().slice(0, 20000);
  if (title.length < 2 || text.length < 2) {
    return NextResponse.json({ error: "Нужны тема и текст" }, { status: 400 });
  }
  const sender = await resolveSender(body?.senderKind || "", body?.senderLabel || "");
  if (!sender) {
    return NextResponse.json({ error: "Укажи, от кого письмо" }, { status: 400 });
  }
  const audience = body?.audience === "clan" || body?.audience === "all" ? body.audience : "picked";
  const ids = await recipientIds({
    audience,
    userIds: Array.isArray(body?.userIds) ? body!.userIds! : [],
  });
  if (!ids.length) {
    return NextResponse.json({ error: "Нет адресатов" }, { status: 400 });
  }
  await prisma.$transaction(async (tx) => {
    const mail = await tx.profileMail.create({
      data: {
        title,
        body: text,
        senderKind: sender.senderKind,
        senderLabel: sender.senderLabel,
        tags: cleanMailTags(body?.tags),
        authorId: author.id,
      },
    });
    const chunk = 400;
    for (let i = 0; i < ids.length; i += chunk) {
      await tx.profileMailRecipient.createMany({
        data: ids.slice(i, i + chunk).map((userId) => ({
          mailId: mail.id,
          userId,
        })),
      });
    }
  });
  return NextResponse.json({ ok: true, sent: ids.length });
}
