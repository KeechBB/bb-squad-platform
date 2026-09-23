import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { SITE_PAGEVIEW_DEDUP_MS } from "@/lib/presence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalizePath(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let p = raw.trim();
  if (!p.startsWith("/")) return null;
  if (p.length > 200) p = p.slice(0, 200);
  // без query/hash
  const q = p.indexOf("?");
  if (q >= 0) p = p.slice(0, q);
  const h = p.indexOf("#");
  if (h >= 0) p = p.slice(0, h);
  if (!p) p = "/";
  return p;
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.steamId || !session.user.profileComplete) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  let body: { path?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad json" }, { status: 400 });
  }
  const path = normalizePath(body.path);
  if (!path) {
    return NextResponse.json({ ok: false, error: "bad path" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({
    where: { steamId: session.user.steamId },
    select: { id: true, nick: true },
  });
  if (!user) {
    return NextResponse.json({ ok: false }, { status: 404 });
  }

  const since = new Date(Date.now() - SITE_PAGEVIEW_DEDUP_MS);
  const recent = await prisma.sitePageVisit.findFirst({
    where: {
      userId: user.id,
      path,
      createdAt: { gte: since },
    },
    select: { id: true },
    orderBy: { createdAt: "desc" },
  });
  if (recent) {
    return NextResponse.json({ ok: true, skipped: true });
  }

  await prisma.sitePageVisit.create({
    data: {
      userId: user.id,
      path,
      nickAt: user.nick || session.user.nick || session.user.steamName || null,
    },
  });

  return NextResponse.json({ ok: true });
}
