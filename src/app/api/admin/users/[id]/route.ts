import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/requireAdmin";
import { isValidSteamId } from "@/lib/admin";
import { isValidAge, isValidName, isValidNick } from "@/lib/validation";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { error } = await requireAdmin();
  if (error) return error;
  const { id } = await ctx.params;

  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) {
    return NextResponse.json({ error: "Не найден" }, { status: 404 });
  }
  return NextResponse.json({ user });
}

export async function PATCH(req: Request, ctx: Ctx) {
  const { error } = await requireAdmin();
  if (error) return error;
  const { id } = await ctx.params;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Некорректные данные" }, { status: 400 });
  }

  const name = String((body as { name?: string }).name ?? "").trim();
  const nick = String((body as { nick?: string }).nick ?? "").trim();
  const age = Number((body as { age?: number }).age);
  const steamId = String((body as { steamId?: string }).steamId ?? "").trim();

  if (!isValidName(name)) {
    return NextResponse.json({ error: "Имя: от 2 до 40 символов" }, { status: 400 });
  }
  if (!isValidNick(nick)) {
    return NextResponse.json(
      { error: "Ник: латиница, цифры, _ и -, 3–20" },
      { status: 400 }
    );
  }
  if (!isValidAge(age)) {
    return NextResponse.json({ error: "Возраст: 14–99" }, { status: 400 });
  }
  if (!isValidSteamId(steamId)) {
    return NextResponse.json({ error: "Steam ID: 15–20 цифр" }, { status: 400 });
  }

  const nickTaken = await prisma.user.findFirst({
    where: { nick, NOT: { id } },
  });
  if (nickTaken) {
    return NextResponse.json({ error: "Ник уже занят" }, { status: 409 });
  }

  const steamTaken = await prisma.user.findFirst({
    where: { steamId, NOT: { id } },
  });
  if (steamTaken) {
    return NextResponse.json({ error: "Steam ID уже занят" }, { status: 409 });
  }

  try {
    const user = await prisma.user.update({
      where: { id },
      data: { name, nick, age, steamId },
    });
    return NextResponse.json({ ok: true, user });
  } catch {
    return NextResponse.json({ error: "Не удалось сохранить" }, { status: 500 });
  }
}
