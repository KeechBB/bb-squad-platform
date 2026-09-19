import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isValidClanName, isValidClanTag } from "@/lib/clan";
import {
  CLAN_LOGO_MAX,
  detectClanLogoMime,
  saveClanLogo,
} from "@/lib/clanLogo";

export const runtime = "nodejs";

export async function GET() {
  const clans = await prisma.clan.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { members: true } },
      leader: { select: { nick: true, name: true } },
    },
  });
  return NextResponse.json({ clans });
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.steamId || !session.user.profileComplete) {
    return NextResponse.json({ error: "Нужен полный профиль" }, { status: 401 });
  }

  const me = await prisma.user.findUnique({
    where: { steamId: session.user.steamId },
  });
  if (!me) {
    return NextResponse.json({ error: "Пользователь не найден" }, { status: 404 });
  }

  const form = await req.formData().catch(() => null);
  if (!form) {
    return NextResponse.json({ error: "Некорректные данные" }, { status: 400 });
  }

  const name = String(form.get("name") || "").trim();
  const tag = String(form.get("tag") || "").trim().toUpperCase();
  const logo = form.get("logo");

  if (!isValidClanName(name)) {
    return NextResponse.json({ error: "Название: 2–40 символов" }, { status: 400 });
  }
  if (!isValidClanTag(tag)) {
    return NextResponse.json(
      { error: "Тег: 2–8 латиница/цифры" },
      { status: 400 }
    );
  }

  const taken = await prisma.clan.findUnique({ where: { tag } });
  if (taken) {
    return NextResponse.json({ error: "Такой тег уже занят" }, { status: 409 });
  }

  let logoUrl: string | null = null;
  const clan = await prisma.clan.create({
    data: {
      name,
      tag,
      leaderId: me.id,
      members: {
        create: { userId: me.id, role: "LEADER" },
      },
    },
  });

  if (logo && typeof logo !== "string" && "arrayBuffer" in logo) {
    const blob = logo as Blob;
    if (blob.size > 0) {
      if (blob.size > CLAN_LOGO_MAX) {
        await prisma.clan.delete({ where: { id: clan.id } });
        return NextResponse.json({ error: "Лого до 5 МБ (png/webp)" }, { status: 400 });
      }
      const buf = Buffer.from(await blob.arrayBuffer());
      const mime = detectClanLogoMime(buf);
      if (!mime) {
        await prisma.clan.delete({ where: { id: clan.id } });
        return NextResponse.json(
          { error: "Лого: только png или webp (с прозрачностью)" },
          { status: 400 }
        );
      }
      logoUrl = await saveClanLogo(clan.id, buf, mime);
      await prisma.clan.update({
        where: { id: clan.id },
        data: { logoUrl },
      });
    }
  }

  const full = await prisma.clan.findUnique({ where: { id: clan.id } });
  return NextResponse.json({ ok: true, clan: full });
}
