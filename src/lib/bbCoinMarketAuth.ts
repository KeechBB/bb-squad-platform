/**
 * Auth gate для API торговой площадки: Steam + заполненный профиль.
 */
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export type MarketUser = {
  id: string;
  steamId: string;
  profileComplete: boolean;
};

export async function requireMarketUser(): Promise<
  { user: MarketUser } | { error: NextResponse }
> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.steamId) {
    return {
      error: NextResponse.json({ ok: false, error: "auth" }, { status: 401 }),
    };
  }
  const user = await prisma.user.findUnique({
    where: { steamId: session.user.steamId },
    select: { id: true, profileComplete: true, steamId: true },
  });
  if (!user?.profileComplete) {
    return {
      error: NextResponse.json({ ok: false, error: "profile" }, { status: 403 }),
    };
  }
  return { user };
}
