import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/requireAdmin";
import {
  canChangeRole,
  effectiveRole,
  isBuiltinSuperAdmin,
  isSuperAdmin,
  isValidSteamId,
  parseRole,
  type AppRole,
} from "@/lib/admin";
import { isValidAge, isValidName, isValidNick } from "@/lib/validation";
import { removeUserAvatarFiles } from "@/lib/avatar";

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
  const actorIsSuper = await isSuperAdmin(actorSteamId);
  const actorRole: AppRole = actorIsSuper ? "SUPER_ADMIN" : "ADMIN";

  const { id } = await ctx.params;
  const existing = await prisma.user.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Не найден" }, { status: 404 });
  }
  const existingRole = effectiveRole(existing.steamId, existing.role as AppRole);

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
    clearAvatar?: boolean;
  };

  if (b.clearAvatar) {
    await removeUserAvatarFiles(existing.id);
    const user = await prisma.user.update({
      where: { id },
      data: { avatarUrl: null },
    });
    return NextResponse.json({ ok: true, user });
  }

  if (b.roleOnly || (b.role && b.name === undefined && b.nick === undefined)) {
    const role = parseRole(String(b.role || ""));
    if (!role || role === "SUPER_ADMIN") {
      return NextResponse.json(
        { error: "Можно выдать только Игрок или Админ" },
        { status: 400 }
      );
    }
    if (!canChangeRole(actorRole, existingRole, existing.steamId)) {
      return NextResponse.json(
        { error: "Только главный админ может менять роли админов" },
        { status: 403 }
      );
    }
    if (existing.steamId === actorSteamId) {
      return NextResponse.json({ error: "Нельзя менять свою роль" }, { status: 403 });
    }
    const user = await prisma.user.update({
      where: { id },
      data: { role },
    });
    return NextResponse.json({ ok: true, user });
  }

  const name = String(b.name ?? "").trim();
  const nick = String(b.nick ?? "").trim();
  const age = Number(b.age);
  const steamId = String(b.steamId ?? "").trim();

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

  let nextRole = existingRole;
  if (b.role != null) {
    const role = parseRole(String(b.role));
    if (!role || role === "SUPER_ADMIN") {
      return NextResponse.json(
        { error: "Можно выдать только Игрок или Админ" },
        { status: 400 }
      );
    }
    if (!canChangeRole(actorRole, existingRole, existing.steamId)) {
      return NextResponse.json(
        { error: "Только главный админ может менять роли админов" },
        { status: 403 }
      );
    }
    if (existing.steamId === actorSteamId) {
      return NextResponse.json({ error: "Нельзя менять свою роль" }, { status: 403 });
    }
    nextRole = role;
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
        role: isBuiltinSuperAdmin(steamId) ? "SUPER_ADMIN" : nextRole,
      },
    });
    return NextResponse.json({ ok: true, user });
  } catch {
    return NextResponse.json({ error: "Не удалось сохранить" }, { status: 500 });
  }
}
