import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  ageFromBirthDate,
  isValidName,
  isValidNick,
  normalizeNick,
  parseBirthDate,
} from "@/lib/validation";
import { parseDiscordInput, parseTelegramInput } from "@/lib/social";
import { livePublish, userLiveChannel } from "@/lib/liveBus";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(req: Request) {
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

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Некорректные данные" }, { status: 400 });
  }

  const b = body as {
    name?: string;
    nick?: string;
    birthDate?: string;
    discord?: string;
    telegram?: string;
  };

  const name = String(b.name ?? "").trim();
  const nick = normalizeNick(String(b.nick ?? ""));
  const birthRaw = String(b.birthDate ?? "").trim();
  const discordRaw = String(b.discord ?? "").trim();
  const telegramRaw = String(b.telegram ?? "").trim();

  if (!isValidNick(nick)) {
    return NextResponse.json(
      { error: "Ник: латиница, цифры, символы и пробелы, 3–24" },
      { status: 400 }
    );
  }
  if (!isValidName(name)) {
    return NextResponse.json({ error: "Имя: от 2 до 40 символов" }, { status: 400 });
  }

  const age = ageFromBirthDate(birthRaw);
  const birthDate = parseBirthDate(birthRaw);
  if (age == null || !birthDate) {
    return NextResponse.json(
      { error: "Дата рождения: ДД.ММ.ГГГГ, возраст 14–99" },
      { status: 400 }
    );
  }

  const discord = parseDiscordInput(discordRaw);
  if ("error" in discord) {
    return NextResponse.json({ error: discord.error }, { status: 400 });
  }
  const telegram = parseTelegramInput(telegramRaw);
  if ("error" in telegram) {
    return NextResponse.json({ error: telegram.error }, { status: 400 });
  }

  const nickTaken = await prisma.user.findFirst({
    where: { nick, NOT: { id: me.id } },
  });
  if (nickTaken) {
    return NextResponse.json({ error: "Этот ник уже занят" }, { status: 409 });
  }

  const user = await prisma.user.update({
    where: { id: me.id },
    data: {
      name,
      nick,
      age,
      birthDate,
      discordTag: discord.tag,
      discordId: discord.id,
      telegram: telegram.username,
    },
  });

  livePublish(userLiveChannel(user.id), JSON.stringify({ type: "profile" }));

  return NextResponse.json({
    ok: true,
    user: {
      id: user.id,
      name: user.name,
      nick: user.nick,
      age: user.age,
      birthDate: user.birthDate
        ? `${String(user.birthDate.getUTCDate()).padStart(2, "0")}.${String(user.birthDate.getUTCMonth() + 1).padStart(2, "0")}.${user.birthDate.getUTCFullYear()}`
        : null,
      discordTag: user.discordTag,
      discordId: user.discordId,
      telegram: user.telegram,
    },
  });
}
