import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  AVATAR_MAX_BYTES,
  detectAvatarMime,
  removeUserAvatarFiles,
  saveUserAvatar,
} from "@/lib/avatar";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.steamId) {
    return NextResponse.json({ error: "Нужен вход" }, { status: 401 });
  }
  if (!session.user.profileComplete) {
    return NextResponse.json({ error: "Сначала заверши регистрацию" }, { status: 403 });
  }

  const dbUser = await prisma.user.findUnique({
    where: { steamId: session.user.steamId },
    select: { id: true },
  });
  if (!dbUser) {
    return NextResponse.json({ error: "Пользователь не найден" }, { status: 404 });
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get("avatar");
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "Выбери файл картинки" }, { status: 400 });
  }
  if (file.size <= 0 || file.size > AVATAR_MAX_BYTES) {
    return NextResponse.json(
      { error: "Файл до 2 МБ (jpg, png, webp)" },
      { status: 400 }
    );
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const mime = detectAvatarMime(buf);
  if (!mime) {
    return NextResponse.json(
      { error: "Нужен jpg, png или webp" },
      { status: 400 }
    );
  }

  const avatarUrl = await saveUserAvatar(dbUser.id, buf, mime);
  const user = await prisma.user.update({
    where: { steamId: session.user.steamId },
    data: { avatarUrl },
  });

  return NextResponse.json({
    ok: true,
    avatarUrl: user.avatarUrl,
  });
}

export async function DELETE() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.steamId) {
    return NextResponse.json({ error: "Нужен вход" }, { status: 401 });
  }

  const dbUser = await prisma.user.findUnique({
    where: { steamId: session.user.steamId },
    select: { id: true },
  });
  if (!dbUser) {
    return NextResponse.json({ error: "Пользователь не найден" }, { status: 404 });
  }

  await removeUserAvatarFiles(dbUser.id);
  const user = await prisma.user.update({
    where: { steamId: session.user.steamId },
    data: { avatarUrl: null },
  });

  return NextResponse.json({
    ok: true,
    avatarUrl: null,
    steamAvatar: user.steamAvatar,
  });
}
