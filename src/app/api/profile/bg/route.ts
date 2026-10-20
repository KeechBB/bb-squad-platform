import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canUseProfileBg, normalizeProfileBg } from "@/lib/profileBg";
import {
  canUseProfilePatch,
  normalizeProfilePatch,
} from "@/lib/profilePatches";
import {
  canUseProfileNickStyle,
  normalizeProfileNickStyle,
} from "@/lib/profileNickStyles";
import {
  ensureBpL10NickStyle,
  ensureBpL5ProfileBg,
  ensureBpL15NickPatch,
} from "@/lib/profileBgUnlocks";
import { writeNickPatchesCache } from "@/lib/nickPatchesCache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.steamId || !session.user.profileComplete) {
    return NextResponse.json({ error: "auth" }, { status: 401 });
  }

  let body: {
    bg?: unknown;
    nickPatch?: unknown;
    nickStyle?: unknown;
  } = {};
  try {
    body = (await req.json()) as {
      bg?: unknown;
      nickPatch?: unknown;
      nickStyle?: unknown;
    };
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }

  const bg = normalizeProfileBg(body.bg);
  const nickPatch =
    body.nickPatch === undefined
      ? undefined
      : normalizeProfilePatch(body.nickPatch);
  const nickStyle =
    body.nickStyle === undefined
      ? undefined
      : normalizeProfileNickStyle(body.nickStyle);

  const current = await prisma.user.findUnique({
    where: { steamId: session.user.steamId },
    select: {
      id: true,
      nick: true,
      unlockedProfileBgs: true,
      unlockedNickPatches: true,
      nickPatch: true,
      unlockedNickStyles: true,
      nickStyle: true,
    },
  });
  if (!current) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const bgUnlocks = await ensureBpL5ProfileBg(current);
  if (
    !canUseProfileBg(bg, {
      steamId: session.user.steamId,
      unlocks: bgUnlocks,
    })
  ) {
    return NextResponse.json({ error: "locked" }, { status: 403 });
  }

  const patchUnlocks = await ensureBpL15NickPatch(current);
  const nextPatch =
    nickPatch === undefined
      ? normalizeProfilePatch(current.nickPatch)
      : nickPatch;
  if (
    !canUseProfilePatch(nextPatch, {
      steamId: session.user.steamId,
      unlocks: patchUnlocks,
    })
  ) {
    return NextResponse.json({ error: "locked" }, { status: 403 });
  }

  const nickStyleUnlocks = await ensureBpL10NickStyle(current);
  const nextNickStyle =
    nickStyle === undefined
      ? normalizeProfileNickStyle(current.nickStyle)
      : nickStyle;
  if (
    !canUseProfileNickStyle(nextNickStyle, {
      unlocks: nickStyleUnlocks,
    })
  ) {
    return NextResponse.json({ error: "locked" }, { status: 403 });
  }

  const me = await prisma.user.update({
    where: { steamId: session.user.steamId },
    data: {
      profileBg: bg,
      ...(nickPatch !== undefined ? { nickPatch: nextPatch } : {}),
      ...(nickStyle !== undefined ? { nickStyle: nextNickStyle } : {}),
    },
    select: { profileBg: true, nickPatch: true, nickStyle: true },
  });

  // Синхронно: рейтинги КВ/ТМ читают nick-patches.json; паблик — live overlay из БД.
  try {
    await writeNickPatchesCache();
  } catch (e) {
    console.warn("[profile/bg] writeNickPatchesCache failed", e);
  }

  return NextResponse.json({
    bg: me.profileBg || null,
    nickPatch: me.nickPatch || null,
    nickStyle: me.nickStyle || null,
  });
}
