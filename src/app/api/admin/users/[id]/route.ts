import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/requireAdmin";
import {
  isBuiltinAdmin,
  isValidSteamId,
  type AppRole,
} from "@/lib/admin";
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
  const gate = await requireAdmin();
  if (gate.error) return gate.error;
  const actorSteamId = gate.session!.user.steamId;
  const { id } = await ctx.params;

  const existing = await prisma.user.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Не найден" }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Некорректные данные" }, { status: 400 });
  }

  const b = body as {
    name?: string;
    nick?: string;
    age?: number;
    steamId?: string;
    role?: string;
    roleOnly?: boolean;
  };

  // Быстрая смена роли из таблицы
  if (b.roleOnly || (b.role && b.name === undefined && b.nick === undefined)) {
    const role = String(b.role || "").toUpperCase();
    if (role !== "USER" && role !== "ADMIN") {
      return NextResponse.json({ error: "Роль: Игрок или Админ" }, { status: 400 });
    }
    if (role === "USER" && isBuiltinAdmin(existing.steamId)) {
      return NextResponse.json(
        { error: "Главного админа снять нельзя" },
        { status: 403 }
      );
    }
    if (role === "USER" && existing.steamId === actorSteamId) {
      return NextResponse.json(
        { error: "Нельзя снять админку с себя" },
        { status: 403 }
      );
    }
    const user = await prisma.user.update({
      where: { id },
      data: { role: role as AppRole },
    });
    return NextResponse.json({ ok: true, user });
  }

  const name = String(b.name ?? "").trim();
  const nick = String(b.nick ?? "").trim();
  const age = Number(b.age);
  const steamId = String(b.steamId ?? "").trim();
  const roleRaw = b.role != null ? String(b.role).toUpperCase() : existing.role;
  const role = roleRaw === "ADMIN" ? "ADMIN" : "USER";

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

  if (role === "USER" && isBuiltinAdmin(existing.steamId)) {
    return NextResponse.json(
      { error: "Главного админа снять нельзя" },
      { status: 403 }
    );
  }
  if (role === "USER" && existing.steamId === actorSteamId) {
    return NextResponse.json(
      { error: "Нельзя снять админку с себя" },
      { status: 403 }
    );
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
      data: {
        name,
        nick,
        age,
        steamId,
        role: isBuiltinAdmin(steamId) ? "ADMIN" : role,
      },
    });
    return NextResponse.json({ ok: true, user });
  } catch {
    return NextResponse.json({ error: "Не удалось сохранить" }, { status: 500 });
  }
}
