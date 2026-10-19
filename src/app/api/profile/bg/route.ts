import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canUseProfileBg, normalizeProfileBg } from "@/lib/profileBg";
import { ensureBpL5ProfileBg } from "@/lib/profileBgUnlocks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.steamId || !session.user.profileComplete) {
    return NextResponse.json({ error: "auth" }, { status: 401 });
  }

  let body: { bg?: unknown } = {};
  try {
    body = (await req.json()) as { bg?: unknown };
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }

  const bg = normalizeProfileBg(body.bg);

  const current = await prisma.user.findUnique({
    where: { steamId: session.user.steamId },
    select: { id: true, nick: true, unlockedProfileBgs: true },
  });
  if (!current) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const unlocks = await ensureBpL5ProfileBg(current);
  if (
    !canUseProfileBg(bg, {
      steamId: session.user.steamId,
      unlocks,
    })
  ) {
    return NextResponse.json({ error: "locked" }, { status: 403 });
  }

  const me = await prisma.user.update({
    where: { steamId: session.user.steamId },
    data: { profileBg: bg },
    select: { profileBg: true },
  });

  return NextResponse.json({ bg: me.profileBg || null });
}
