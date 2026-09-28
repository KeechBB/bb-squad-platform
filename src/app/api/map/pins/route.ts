import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/admin";
import { countBlackberryClanMembers, isBlackberryClanMember } from "@/lib/blackberryClan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireBbMember() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.steamId || !session.user.profileComplete) {
    return { ok: false as const, response: NextResponse.json({ error: "Нужен полный профиль" }, { status: 401 }) };
  }
  if (!(await isBlackberryClanMember(session.user.steamId))) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "Карта клана только для участников BlackBerry" },
        { status: 403 }
      ),
    };
  }
  return { ok: true as const, session };
}

export type MapPinPublic = {
  id: string;
  userId: string;
  nick: string;
  country: string;
  region: string | null;
  city: string;
  lat: number;
  lon: number;
};

/** Сгруппированные точки: один город → список игроков */
export type MapPinGroup = {
  key: string;
  country: string;
  region: string | null;
  city: string;
  lat: number;
  lon: number;
  members: { userId: string; nick: string; pinId: string }[];
};

function groupPins(pins: MapPinPublic[]): MapPinGroup[] {
  const map = new Map<string, MapPinGroup>();
  for (const p of pins) {
    const key = `${p.country.trim().toLowerCase()}|${(p.region || "").trim().toLowerCase()}|${p.city.trim().toLowerCase()}`;
    const existing = map.get(key);
    if (existing) {
      existing.members.push({ userId: p.userId, nick: p.nick, pinId: p.id });
      const n = existing.members.length;
      existing.lat = (existing.lat * (n - 1) + p.lat) / n;
      existing.lon = (existing.lon * (n - 1) + p.lon) / n;
    } else {
      map.set(key, {
        key,
        country: p.country,
        region: p.region,
        city: p.city,
        lat: p.lat,
        lon: p.lon,
        members: [{ userId: p.userId, nick: p.nick, pinId: p.id }],
      });
    }
  }
  return [...map.values()];
}

export async function GET() {
  try {
    const gate = await requireBbMember();
    if (!gate.ok) return gate.response;
    const session = gate.session;

    const rows = await prisma.mapPin.findMany({
      include: { user: { select: { id: true, nick: true, steamName: true } } },
      orderBy: { updatedAt: "desc" },
    });

    const pins: MapPinPublic[] = rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      nick: r.user.nick || r.user.steamName || "Игрок",
      country: r.country,
      region: r.region,
      city: r.city,
      lat: r.lat,
      lon: r.lon,
    }));

    const me = await prisma.user.findUnique({
      where: { steamId: session.user.steamId },
      select: { id: true },
    });

    const canModerate = await isAdmin(session.user.steamId);
    const clanMemberCount = await countBlackberryClanMembers();

    return NextResponse.json({
      pins,
      groups: groupPins(pins),
      myPin: me ? pins.find((p) => p.userId === me.id) ?? null : null,
      myUserId: me?.id ?? null,
      canModerate,
      clanMemberCount,
      pinCount: pins.length,
    });
  } catch (e) {
    console.error("[map/pins GET]", e);
    const msg = e instanceof Error ? e.message : "Ошибка БД карты";
    return NextResponse.json(
      {
        error: msg.includes("mapPin") || msg.includes("MapPin") || msg.includes("does not exist")
          ? "Таблица меток ещё не создана — нужен prisma db push на сервере"
          : "Не удалось загрузить метки",
      },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  const gate = await requireBbMember();
  if (!gate.ok) return gate.response;
  const session = gate.session;

  const me = await prisma.user.findUnique({
    where: { steamId: session.user.steamId },
    select: { id: true },
  });
  if (!me) {
    return NextResponse.json({ error: "Пользователь не найден" }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Некорректные данные" }, { status: 400 });
  }

  const country = String((body as { country?: string }).country ?? "").trim();
  const regionRaw = String((body as { region?: string }).region ?? "").trim();
  const city = String((body as { city?: string }).city ?? "").trim();
  const lat = Number((body as { lat?: number }).lat);
  const lon = Number((body as { lon?: number }).lon);

  if (country.length < 2 || country.length > 80) {
    return NextResponse.json({ error: "Укажи страну" }, { status: 400 });
  }
  if (city.length < 1 || city.length > 80) {
    return NextResponse.json({ error: "Укажи город" }, { status: 400 });
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return NextResponse.json({ error: "Некорректные координаты" }, { status: 400 });
  }

  const region = regionRaw.length > 0 ? regionRaw.slice(0, 80) : null;

  const pin = await prisma.mapPin.upsert({
    where: { userId: me.id },
    create: { userId: me.id, country, region, city, lat, lon },
    update: { country, region, city, lat, lon },
  });

  return NextResponse.json({ ok: true, pin });
}

/** Своя метка: DELETE без body. Чужую: ?userId=… (только admin/HR/deputy/super). */
export async function DELETE(req: Request) {
  const gate = await requireBbMember();
  if (!gate.ok) return gate.response;
  const session = gate.session;

  const me = await prisma.user.findUnique({
    where: { steamId: session.user.steamId },
    select: { id: true },
  });
  if (!me) {
    return NextResponse.json({ error: "Пользователь не найден" }, { status: 404 });
  }

  const url = new URL(req.url);
  const targetUserId = String(url.searchParams.get("userId") ?? "").trim();
  const targetPinId = String(url.searchParams.get("pinId") ?? "").trim();

  if (targetUserId || targetPinId) {
    const canModerate = await isAdmin(session.user.steamId);
    if (!canModerate) {
      return NextResponse.json({ error: "Нет прав снимать чужие метки" }, { status: 403 });
    }
    if (targetPinId) {
      await prisma.mapPin.deleteMany({ where: { id: targetPinId } });
    } else {
      await prisma.mapPin.deleteMany({ where: { userId: targetUserId } });
    }
    return NextResponse.json({ ok: true });
  }

  await prisma.mapPin.deleteMany({ where: { userId: me.id } });
  return NextResponse.json({ ok: true });
}
