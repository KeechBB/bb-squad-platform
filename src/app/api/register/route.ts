import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  ageFromBirthDate,
  isValidName,
  parseBirthDate,
} from "@/lib/validation";
import { assignRegNoIfNeeded } from "@/lib/regNo";
import { personLabel, writeActionLog } from "@/lib/actionLog";
import { attachOpponentClanOnRegister } from "@/lib/opponentClan";
import { alertNewRegistration } from "@/lib/bbAlerts";
import { allocateUniqueSteamNick } from "@/lib/steamDisplayNick";

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
  const birthRaw = String((body as { birthDate?: string }).birthDate ?? "").trim();

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

  const me = await prisma.user.findUnique({
    where: { steamId: session.user.steamId },
    select: {
      id: true,
      profileComplete: true,
      steamName: true,
      steamId: true,
    },
  });
  if (!me) {
    return NextResponse.json({ error: "Пользователь не найден" }, { status: 404 });
  }

  const nick = await allocateUniqueSteamNick(
    me.steamId,
    me.steamName || session.user.steamName
  );

  const wasIncomplete = !me.profileComplete;

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
  const label = personLabel(user);

  if (wasIncomplete) {
    await writeActionLog({
      category: "profile",
      action: "register",
      message: `${label} зарегистрировался на сайте${regNo != null ? ` (№${regNo})` : ""}`,
      actorId: user.id,
      actorNick: label,
      meta: { regNo, steamId: user.steamId },
    });

    try {
      await prisma.squadServerSession.updateMany({
        where: { steamId: user.steamId, userId: null },
        data: { userId: user.id },
      });
    } catch (err) {
      console.error("attach orphan sessions failed", err);
    }

    try {
      const existingJob = await prisma.squadLogBackfillJob.findFirst({
        where: {
          steamId: user.steamId,
          status: { in: ["pending", "running"] },
        },
        select: { id: true },
      });
      if (!existingJob) {
        await prisma.squadLogBackfillJob.create({
          data: {
            userId: user.id,
            steamId: user.steamId,
            nick: user.nick,
            status: "pending",
          },
        });
      }
    } catch (err) {
      console.error("backfill enqueue failed", err);
    }

    try {
      const joined = await attachOpponentClanOnRegister(user.id);
      if (joined.joined && joined.tag) {
        await writeActionLog({
          category: "clan",
          action: "auto_join_external",
          message: `${label} автоматически вступил в [${joined.tag}] (ростер КВ)`,
          actorId: user.id,
          actorNick: label,
          clanId: joined.clanId || undefined,
          clanTag: joined.tag,
        });
      }
    } catch (err) {
      console.error("attach opponent clan failed", err);
    }

    try {
      await alertNewRegistration({
        nick: user.nick || nick,
        name: user.name || name,
        steamId: user.steamId,
        regNo,
      });
    } catch (err) {
      console.error("telegram register alert failed", err);
    }
  }

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
