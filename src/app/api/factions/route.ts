import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isBuiltinSuperAdmin } from "@/lib/admin";
import { factionPath, factionSlugForSteam, isBlackberryClan } from "@/lib/factions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Список фракций BlackBerry для выпадающего меню «Моя фракция». */
export async function GET() {
  const session = await getServerSession(authOptions);
  const steamId = session?.user?.steamId ?? null;
  if (!steamId) {
    return NextResponse.json({ error: "Нужен вход" }, { status: 401 });
  }

  const keech = isBuiltinSuperAdmin(steamId);
  const user = await prisma.user.findUnique({
    where: { steamId },
    select: {
      id: true,
      clanMemberships: {
        select: {
          clan: { select: { id: true, tag: true, isExternal: true } },
        },
      },
    },
  });
  const bbClan = user?.clanMemberships.find((m) => isBlackberryClan(m.clan))?.clan;
  if (!keech && !bbClan) {
    return NextResponse.json({ error: "Нет доступа" }, { status: 404 });
  }

  const clanId =
    bbClan?.id ||
    (
      await prisma.clan.findFirst({
        where: { tag: "BB", isExternal: false },
        select: { id: true },
      })
    )?.id;
  if (!clanId) {
    return NextResponse.json({ factions: [], mineSlug: null });
  }

  const factions = await prisma.faction.findMany({
    where: { clanId },
    orderBy: { name: "asc" },
    select: { id: true, name: true, slug: true, logoUrl: true },
  });
  const mineSlug = await factionSlugForSteam(steamId);

  return NextResponse.json({
    mineSlug,
    factions: factions.map((f) => ({
      id: f.id,
      name: f.name,
      slug: f.slug,
      href: factionPath(f.slug),
      logoUrl: f.logoUrl,
      mine: Boolean(mineSlug && mineSlug === f.slug),
    })),
  });
}
