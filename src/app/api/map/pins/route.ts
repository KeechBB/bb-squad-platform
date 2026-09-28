import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  const session = await getServerSession(authOptions);
  if (!session?.user?.steamId || !session.user.profileComplete) {
    return NextResponse.json({ error: "Нужен полный профиль" }, { status: 401 });
  }

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

  return NextResponse.json({
    pins,
    groups: groupPins(pins),
    myPin: me ? pins.find((p) => p.userId === me.id) ?? null : null,
    myUserId: me?.id ?? null,
    canModerate,
  });
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.steamId || !session.user.profileComplete) {
    return NextResponse.json({ error: "Нужен полный профиль" }, { status: 401 });
  }

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

  // upsert = можно убрать и поставить заново / сменить город
  const pin = await prisma.mapPin.upsert({
    where: { userId: me.id },
    create: { userId: me.id, country, region, city, lat, lon },
    update: { country, region, city, lat, lon },
  });

  return NextResponse.json({ ok: true, pin });
}

/** Своя метка: DELETE без body. Чужую: ?userId=… (только admin/HR/deputy/super). */
export async function DELETE(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.steamId || !session.user.profileComplete) {
    return NextResponse.json({ error: "Нужен полный профиль" }, { status: 401 });
  }

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
