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

function asBlob(entry: FormDataEntryValue | null): Blob | null {
  if (!entry || typeof entry === "string") return null;
  if (typeof (entry as Blob).arrayBuffer !== "function") return null;
  return entry as Blob;
}

function prismaHint(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/avatarUrl|column|Unknown arg/i.test(msg)) {
    return "На сервере нет поля avatarUrl — выполни: npx prisma db push";
  }
  if (/EACCES|EPERM|ENOENT|read-only/i.test(msg)) {
    return "Нет прав записать файл в public/uploads/avatars";
  }
  return "Ошибка сервера при загрузке";
}

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.steamId) {
      return NextResponse.json({ error: "Нужен вход" }, { status: 401 });
    }
    if (!session.user.profileComplete) {
      return NextResponse.json(
        { error: "Сначала заверши регистрацию" },
        { status: 403 }
      );
    }

    const dbUser = await prisma.user.findUnique({
      where: { steamId: session.user.steamId },
      select: { id: true },
    });
    if (!dbUser) {
      return NextResponse.json({ error: "Пользователь не найден" }, { status: 404 });
    }

    const form = await req.formData().catch(() => null);
    const blob = asBlob(form?.get("avatar") ?? null);
    if (!blob) {
      return NextResponse.json({ error: "Выбери файл картинки" }, { status: 400 });
    }
    if (blob.size <= 0 || blob.size > AVATAR_MAX_BYTES) {
      return NextResponse.json(
        { error: "Файл до 20 МБ (jpg, png, webp)" },
        { status: 400 }
      );
    }

    const buf = Buffer.from(await blob.arrayBuffer());
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
  } catch (err) {
    console.error("[avatar POST]", err);
    return NextResponse.json({ error: prismaHint(err) }, { status: 500 });
  }
}

export async function DELETE() {
  try {
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
  } catch (err) {
    console.error("[avatar DELETE]", err);
    return NextResponse.json({ error: prismaHint(err) }, { status: 500 });
  }
}
