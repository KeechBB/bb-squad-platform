import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  ageFromBirthDate,
  isValidName,
  isValidNick,
  parseBirthDate,
} from "@/lib/validation";
import { assignRegNoIfNeeded } from "@/lib/regNo";

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.steamId) {
    return NextResponse.json({ error: "Нужен вход через Steam" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Некорректные данные" }, { status: 400 });
  }

  const name = String((body as { name?: string }).name ?? "").trim();
  const nick = String((body as { nick?: string }).nick ?? "").trim();
  const birthRaw = String((body as { birthDate?: string }).birthDate ?? "").trim();

  if (!isValidNick(nick)) {
    return NextResponse.json(
      {
        error:
          "Ник: латиница, цифры и символы, длина 3–24 (это игровой никнейм)",
      },
      { status: 400 }
    );
  }
  if (!isValidName(name)) {
    return NextResponse.json(
      { error: "Имя: от 2 до 40 символов" },
      { status: 400 }
    );
  }

  const age = ageFromBirthDate(birthRaw);
  const birthDate = parseBirthDate(birthRaw);
  if (age == null || !birthDate) {
    return NextResponse.json(
      {
        error:
          "Дата рождения: формат ДД.ММ.ГГГГ, возраст должен быть от 14 до 99",
      },
      { status: 400 }
    );
  }

  const taken = await prisma.user.findFirst({
    where: {
      nick,
      NOT: { steamId: session.user.steamId },
    },
  });
  if (taken) {
    return NextResponse.json(
      { error: "Этот ник уже занят" },
      { status: 409 }
    );
  }

  const user = await prisma.user.update({
    where: { steamId: session.user.steamId },
    data: {
      name,
      nick,
      age,
      birthDate,
      profileComplete: true,
    },
  });

  const regNo = await assignRegNoIfNeeded(user.id);

  return NextResponse.json({
    ok: true,
    user: {
      id: user.id,
      name: user.name,
      nick: user.nick,
      age: user.age,
      birthDate: user.birthDate?.toISOString().slice(0, 10) ?? null,
      profileComplete: user.profileComplete,
      regNo,
    },
  });
}
