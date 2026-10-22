import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MATCH_KEY_RE = /^\d{4}-\d{2}:[A-Za-z0-9._\-]{1,64}$/;

type VoteBag = {
  likes: number;
  dislikes: number;
  myVote: 1 | -1 | null;
};

function emptyBag(): VoteBag {
  return { likes: 0, dislikes: 0, myVote: null };
}

async function viewerId(steamId: string | undefined | null) {
  if (!steamId) return null;
  const me = await prisma.user.findUnique({
    where: { steamId },
    select: { id: true },
  });
  return me?.id || null;
}

/** GET ?month=2026-10 — сводка голосов по всем матчам месяца */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const month = String(url.searchParams.get("month") || "").trim();
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: "month=YYYY-MM" }, { status: 400 });
  }

  const session = await getServerSession(authOptions);
  const uid = await viewerId(
    session?.user?.profileComplete ? session.user.steamId : null
  );

  const prefix = `${month}:`;
  const rows = await prisma.trainingMatchVote.findMany({
    where: { matchKey: { startsWith: prefix } },
    select: { matchKey: true, userId: true, value: true },
  });

  const byMatch: Record<string, VoteBag> = {};
  for (const r of rows) {
    const mid = r.matchKey.slice(prefix.length);
    if (!mid) continue;
    if (!byMatch[mid]) byMatch[mid] = emptyBag();
    const bag = byMatch[mid];
    if (r.value === 1) bag.likes += 1;
    else if (r.value === -1) bag.dislikes += 1;
    if (uid && r.userId === uid) {
      bag.myVote = r.value === 1 || r.value === -1 ? (r.value as 1 | -1) : null;
    }
  }

  return NextResponse.json({
    ok: true,
    month,
    authed: Boolean(uid),
    votes: byMatch,
  });
}

/** POST { matchKey, value: 1|-1 } — поставить / сменить / снять */
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.steamId || !session.user.profileComplete) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    matchKey?: unknown;
    month?: unknown;
    matchId?: unknown;
    value?: unknown;
  };

  let matchKey = String(body.matchKey || "").trim();
  if (!matchKey) {
    const month = String(body.month || "").trim();
    const matchId = String(body.matchId || "").trim();
    if (/^\d{4}-\d{2}$/.test(month) && matchId) {
      matchKey = `${month}:${matchId}`;
    }
  }
  if (!MATCH_KEY_RE.test(matchKey)) {
    return NextResponse.json({ error: "bad matchKey" }, { status: 400 });
  }

  const raw = Number(body.value);
  if (raw !== 1 && raw !== -1) {
    return NextResponse.json({ error: "value: 1 или -1" }, { status: 400 });
  }
  const value = raw as 1 | -1;

  const me = await prisma.user.findUnique({
    where: { steamId: session.user.steamId },
    select: { id: true },
  });
  if (!me) return NextResponse.json({ error: "no user" }, { status: 401 });

  const existing = await prisma.trainingMatchVote.findUnique({
    where: { matchKey_userId: { matchKey, userId: me.id } },
    select: { id: true, value: true },
  });

  if (existing && existing.value === value) {
    await prisma.trainingMatchVote.delete({ where: { id: existing.id } });
  } else if (existing) {
    await prisma.trainingMatchVote.update({
      where: { id: existing.id },
      data: { value },
    });
  } else {
    await prisma.trainingMatchVote.create({
      data: { matchKey, userId: me.id, value },
    });
  }

  const [likes, dislikes, mine] = await Promise.all([
    prisma.trainingMatchVote.count({ where: { matchKey, value: 1 } }),
    prisma.trainingMatchVote.count({ where: { matchKey, value: -1 } }),
    prisma.trainingMatchVote.findUnique({
      where: { matchKey_userId: { matchKey, userId: me.id } },
      select: { value: true },
    }),
  ]);
  const v = mine?.value;
  return NextResponse.json({
    ok: true,
    matchKey,
    likes,
    dislikes,
    myVote: v === 1 || v === -1 ? v : null,
  });
}
