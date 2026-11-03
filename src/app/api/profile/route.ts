import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  ageFromBirthDate,
  isValidName,
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
    birthDate?: string;
    discord?: string;
    telegram?: string;
  };

  const discordRaw = String(b.discord ?? "").trim();
  const telegramRaw = String(b.telegram ?? "").trim();
  const nameRaw = b.name == null ? "" : String(b.name).trim();
  const birthRaw = b.birthDate == null ? "" : String(b.birthDate).trim();

  let name = me.name || "";
  let age = me.age;
  let birthDate = me.birthDate;
  if (nameRaw || birthRaw) {
    if (!isValidName(nameRaw)) {
      return NextResponse.json({ error: "Имя: от 2 до 40 символов" }, { status: 400 });
    }
    const nextAge = ageFromBirthDate(birthRaw);
    const nextBirth = parseBirthDate(birthRaw);
    if (nextAge == null || !nextBirth) {
      return NextResponse.json(
        { error: "Дата рождения: ДД.ММ.ГГГГ, возраст 14–99" },
        { status: 400 }
      );
    }
    name = nameRaw;
    age = nextAge;
    birthDate = nextBirth;
  }

  const discord = parseDiscordInput(discordRaw);
  if ("error" in discord) {
    return NextResponse.json({ error: discord.error }, { status: 400 });
  }
  const telegram = parseTelegramInput(telegramRaw);
  if ("error" in telegram) {
    return NextResponse.json({ error: telegram.error }, { status: 400 });
  }

  // Ник только из Steam (см. syncUserNickFromSteam) — PATCH его не меняет.
  const user = await prisma.user.update({
    where: { id: me.id },
    data: {
      name,
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
    nickChanged: false,
    aliasOk: null,
    user: {
      id: user.id,
      nick: user.nick,
      discordTag: user.discordTag,
      discordId: user.discordId,
      telegram: user.telegram,
    },
  });
}
