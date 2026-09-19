import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/requireAdmin";
import {
  canSetRole,
  effectiveRole,
  getUserRole,
  isBuiltinDeputy,
  isBuiltinSuperAdmin,
  isValidSteamId,
  parseRole,
  type AppRole,
} from "@/lib/admin";
import { ageFromBirthDate, isValidAge, isValidName, isValidNick, parseBirthDate } from "@/lib/validation";
import { removeUserAvatarFiles } from "@/lib/avatar";
import { livePublish, userLiveChannel } from "@/lib/liveBus";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

function lockedRoleForSteam(steamId: string, role: AppRole): AppRole {
  if (isBuiltinSuperAdmin(steamId)) return "SUPER_ADMIN";
  if (isBuiltinDeputy(steamId)) return "DEPUTY";
  return role;
}

function notifyRoleChange(userId: string, role: AppRole) {
  livePublish(
    userLiveChannel(userId),
    JSON.stringify({ type: "role", role })
  );
}

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
  const actorRole = (await getUserRole(actorSteamId)) || "USER";

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
    birthDate?: string;
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
    if (!role) {
      return NextResponse.json({ error: "Некорректная роль" }, { status: 400 });
    }
    if (existing.steamId === actorSteamId) {
      return NextResponse.json({ error: "Нельзя менять свою роль" }, { status: 403 });
    }
    if (!canSetRole(actorRole, existingRole, existing.steamId, role)) {
      return NextResponse.json(
        { error: "Недостаточно прав для этой роли" },
        { status: 403 }
      );
    }
    const user = await prisma.user.update({
      where: { id },
      data: { role },
    });
    notifyRoleChange(user.id, role);
    return NextResponse.json({ ok: true, user });
  }

  const name = String(b.name ?? "").trim();
  const nick = String(b.nick ?? "").trim();
  const steamId = String(b.steamId ?? "").trim();

  if (!isValidName(name)) {
    return NextResponse.json({ error: "Имя: от 2 до 40 символов" }, { status: 400 });
  }
  if (!isValidNick(nick)) {
    return NextResponse.json(
      { error: "Ник: латиница, цифры и символы, 3–24" },
      { status: 400 }
    );
  }
  const birthRaw = String(b.birthDate ?? "").trim();
  let age = Number(b.age);
  let birthDate: Date | null = null;
  if (birthRaw) {
    const fromBirth = ageFromBirthDate(birthRaw);
    const parsed = parseBirthDate(birthRaw);
    if (fromBirth == null || !parsed) {
      return NextResponse.json(
        { error: "Дата рождения: ДД.ММ.ГГГГ или календарь (возраст 14–99)" },
        { status: 400 }
      );
    }
    age = fromBirth;
    birthDate = parsed;
  } else if (!isValidAge(age)) {
    return NextResponse.json({ error: "Возраст: 14–99" }, { status: 400 });
  }
  if (!isValidSteamId(steamId)) {
    return NextResponse.json({ error: "Steam ID: 15–20 цифр" }, { status: 400 });
  }

  let nextRole = existingRole;
  if (b.role != null) {
    const role = parseRole(String(b.role));
    if (!role) {
      return NextResponse.json({ error: "Некорректная роль" }, { status: 400 });
    }
    if (existing.steamId === actorSteamId) {
      return NextResponse.json({ error: "Нельзя менять свою роль" }, { status: 403 });
    }
    if (!canSetRole(actorRole, existingRole, existing.steamId, role)) {
      return NextResponse.json(
        { error: "Недостаточно прав для этой роли" },
        { status: 403 }
      );
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
        ...(birthDate ? { birthDate } : {}),
        steamId,
        role: lockedRoleForSteam(steamId, nextRole),
      },
    });
    if (nextRole !== existingRole) {
      notifyRoleChange(user.id, lockedRoleForSteam(steamId, nextRole));
    }
    return NextResponse.json({ ok: true, user });
  } catch {
    return NextResponse.json({ error: "Не удалось сохранить" }, { status: 500 });
  }
}
