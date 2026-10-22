import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { SITE_NOTICES, findSiteNotice } from "@/lib/siteNotices";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function meId(steamId: string) {
  const me = await prisma.user.findUnique({
    where: { steamId },
    select: { id: true },
  });
  return me?.id ?? null;
}

/** GET — непрочитанные общие уведомления зарегистрированного игрока. */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.steamId || !session.user.profileComplete) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const userId = await meId(session.user.steamId);
  if (!userId) return NextResponse.json({ error: "no user" }, { status: 401 });

  const states = await prisma.siteNoticeState.findMany({
    where: { userId, noticeId: { in: SITE_NOTICES.map((n) => n.id) } },
  });
  const byId = new Map(states.map((s) => [s.noticeId, s]));

  const notices = SITE_NOTICES.filter((n) => !byId.get(n.id)?.dismissedAt).map(
    (n) => ({
      ...n,
      imageUrl: null as string | null,
      kind: "site",
      seen: Boolean(byId.get(n.id)?.seenAt),
    })
  );

  const personal = await prisma.userNotice.findMany({
    where: { userId, dismissedAt: null },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  return NextResponse.json({
    ok: true,
    notices: [
      ...personal.map((n) => ({
        id: n.id,
        title: n.title,
        body: n.body,
        href: n.href,
        linkLabel: n.linkLabel,
        imageUrl: n.imageUrl,
        kind: n.kind,
        seen: Boolean(n.seenAt),
      })),
      ...notices,
    ],
  });
}

/** POST — открыл колокольчик (seen) или закрыл карточку (dismiss). */
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.steamId || !session.user.profileComplete) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const userId = await meId(session.user.steamId);
  if (!userId) return NextResponse.json({ error: "no user" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as {
    noticeId?: string;
    action?: string;
  } | null;
  const noticeId = body?.noticeId?.trim() || "";
  const action = body?.action;
  if (!noticeId || (action !== "seen" && action !== "dismiss")) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  const now = new Date();
  if (findSiteNotice(noticeId)) {
    await prisma.siteNoticeState.upsert({
      where: { userId_noticeId: { userId, noticeId } },
      create: {
        userId,
        noticeId,
        seenAt: now,
        dismissedAt: action === "dismiss" ? now : null,
      },
      update: {
        seenAt: now,
        ...(action === "dismiss" ? { dismissedAt: now } : {}),
      },
    });
    return NextResponse.json({ ok: true });
  }

  const mine = await prisma.userNotice.findFirst({
    where: { id: noticeId, userId },
    select: { id: true },
  });
  if (!mine) return NextResponse.json({ error: "bad request" }, { status: 400 });
  await prisma.userNotice.update({
    where: { id: mine.id },
    data: {
      seenAt: now,
      ...(action === "dismiss" ? { dismissedAt: now } : {}),
    },
  });

  return NextResponse.json({ ok: true });
}
