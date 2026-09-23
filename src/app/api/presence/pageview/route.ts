import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { SITE_PAGEVIEW_DEDUP_MS } from "@/lib/presence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CLIENT_KEY_RE = /^[a-zA-Z0-9_-]{8,64}$/;

function normalizePath(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let p = raw.trim();
  if (!p.startsWith("/")) return null;
  if (p.length > 200) p = p.slice(0, 200);
  const q = p.indexOf("?");
  if (q >= 0) p = p.slice(0, q);
  const h = p.indexOf("#");
  if (h >= 0) p = p.slice(0, h);
  if (!p) p = "/";
  return p;
}

function cleanRef(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let s = raw.trim().slice(0, 500);
  if (!s || s === "null" || s === "undefined") return null;
  try {
    const u = new URL(s);
    // свой сайт не считаем внешним источником
    if (
      u.hostname.endsWith("bb-squad.ru") ||
      u.hostname === "localhost" ||
      u.hostname === "127.0.0.1"
    ) {
      return null;
    }
    return `${u.origin}${u.pathname}`.slice(0, 300);
  } catch {
    return s.slice(0, 300);
  }
}

function cleanUtm(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim().slice(0, 80);
  return s || null;
}

function cleanUa(raw: string | null): string | null {
  if (!raw) return null;
  return raw.slice(0, 180);
}

export async function POST(req: Request) {
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad json" }, { status: 400 });
  }

  const path = normalizePath(body.path);
  const clientKey =
    typeof body.clientKey === "string" && CLIENT_KEY_RE.test(body.clientKey)
      ? body.clientKey
      : null;
  if (!path || !clientKey) {
    return NextResponse.json({ ok: false, error: "bad path/key" }, { status: 400 });
  }

  const referrer = cleanRef(body.referrer);
  const utmSource = cleanUtm(body.utmSource);
  const utmMedium = cleanUtm(body.utmMedium);
  const utmCampaign = cleanUtm(body.utmCampaign);
  const ua = cleanUa(req.headers.get("user-agent"));

  const session = await getServerSession(authOptions);
  let userId: string | null = null;
  let nickAt: string | null = null;
  if (session?.user?.steamId && session.user.profileComplete) {
    const user = await prisma.user.findUnique({
      where: { steamId: session.user.steamId },
      select: { id: true, nick: true },
    });
    if (user) {
      userId = user.id;
      nickAt = user.nick || session.user.nick || session.user.steamName || null;
    }
  }

  const now = new Date();
  let visitor = await prisma.siteVisitor.findUnique({
    where: { clientKey },
  });

  if (!visitor) {
    visitor = await prisma.siteVisitor.create({
      data: {
        clientKey,
        userId,
        referrer,
        landingPath: path,
        utmSource,
        utmMedium,
        utmCampaign,
        userAgent: ua,
        lastSeenAt: now,
      },
    });
  } else {
    visitor = await prisma.siteVisitor.update({
      where: { id: visitor.id },
      data: {
        lastSeenAt: now,
        ...(userId && !visitor.userId ? { userId } : {}),
        ...(userId && visitor.userId !== userId ? { userId } : {}),
        ...(!visitor.referrer && referrer ? { referrer } : {}),
        ...(!visitor.landingPath ? { landingPath: path } : {}),
        ...(!visitor.utmSource && utmSource ? { utmSource } : {}),
        ...(!visitor.utmMedium && utmMedium ? { utmMedium } : {}),
        ...(!visitor.utmCampaign && utmCampaign ? { utmCampaign } : {}),
        ...(!visitor.userAgent && ua ? { userAgent: ua } : {}),
      },
    });
  }

  const since = new Date(Date.now() - SITE_PAGEVIEW_DEDUP_MS);
  const recent = await prisma.sitePageVisit.findFirst({
    where: {
      visitorId: visitor.id,
      path,
      createdAt: { gte: since },
    },
    select: { id: true },
    orderBy: { createdAt: "desc" },
  });
  if (recent) {
    return NextResponse.json({ ok: true, skipped: true, visitorId: visitor.id });
  }

  await prisma.sitePageVisit.create({
    data: {
      visitorId: visitor.id,
      userId,
      path,
      nickAt,
      referrer,
    },
  });

  return NextResponse.json({ ok: true, visitorId: visitor.id });
}
