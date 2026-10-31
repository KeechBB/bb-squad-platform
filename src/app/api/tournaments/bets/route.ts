import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { saveTournamentBet, tournamentBetsPayload } from "@/lib/tournamentBets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function viewer() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.steamId) return null;
  return prisma.user.findUnique({
    where: { steamId: session.user.steamId },
    select: { id: true, profileComplete: true },
  });
}

export async function GET() {
  const user = await viewer();
  const payload = await tournamentBetsPayload(user);
  return NextResponse.json(payload);
}

export async function POST(req: Request) {
  const user = await viewer();
  if (!user) return NextResponse.json({ error: "Войди через Steam" }, { status: 401 });
  if (!user.profileComplete) {
    return NextResponse.json({ error: "Сначала заполни профиль" }, { status: 400 });
  }
  const body = await req.json().catch(() => null);
  const saved = await saveTournamentBet(user.id, body);
  if ("error" in saved) {
    return NextResponse.json({ error: saved.error }, { status: 400 });
  }
  const payload = await tournamentBetsPayload(user);
  return NextResponse.json(payload);
}
