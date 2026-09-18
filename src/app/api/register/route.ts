import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isValidAge, isValidName, isValidNick } from "@/lib/validation";

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
  const age = Number((body as { age?: number }).age);

  if (!isValidName(name)) {
    return NextResponse.json(
      { error: "Имя: от 2 до 40 символов" },
      { status: 400 }
    );
  }
  if (!isValidNick(nick)) {
    return NextResponse.json(
      {
        error:
          "Ник: только латиница, цифры, _ и -, длина 3–20",
      },
      { status: 400 }
    );
  }
  if (!isValidAge(age)) {
    return NextResponse.json(
      { error: "Возраст: целое число от 14 до 99" },
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
      profileComplete: true,
    },
  });

  return NextResponse.json({
    ok: true,
    user: {
      id: user.id,
      name: user.name,
      nick: user.nick,
      age: user.age,
      profileComplete: user.profileComplete,
    },
  });
}
