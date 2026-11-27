import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { loadFactionView } from "@/lib/factions";
import {
  factionRaceBoard,
  loadRacePenaltyForFaction,
} from "@/lib/factionRace";
import { openRacePenaltyAuction } from "@/lib/factionAuction";
import { isBuiltinSuperAdmin } from "@/lib/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const session = await getServerSession(authOptions);
  const { slug } = await ctx.params;
  const loaded = await loadFactionView(
    decodeURIComponent(slug),
    session?.user?.steamId ?? null,
  );
  if (loaded.error || !loaded.view) {
    return NextResponse.json({ error: "Нет доступа" }, { status: 404 });
  }
  const board = await factionRaceBoard(loaded.view.clanId);
  const penalty = await loadRacePenaltyForFaction(loaded.view.id);
  return NextResponse.json({
    ...board,
    penalty,
    canNominate: Boolean(
      loaded.view.canManage ||
        loaded.view.keech ||
        (session?.user?.steamId &&
          isBuiltinSuperAdmin(session.user.steamId)),
    ),
    viewerFactionId: loaded.view.id,
  });
}

export async function POST(req: Request, ctx: Ctx) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.steamId) {
    return NextResponse.json({ error: "Нужен вход" }, { status: 401 });
  }
  const { slug } = await ctx.params;
  const loaded = await loadFactionView(
    decodeURIComponent(slug),
    session.user.steamId,
  );
  if (loaded.error || !loaded.view || !loaded.me) {
    return NextResponse.json({ error: "Нет доступа" }, { status: 404 });
  }
  const keech = isBuiltinSuperAdmin(session.user.steamId);
  if (!loaded.view.canManage && !keech) {
    return NextResponse.json({ error: "Только штаб фракции" }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    op?: string;
    userId?: string;
  };
  if (String(body.op || "") !== "nominate_penalty") {
    return NextResponse.json({ error: "unknown_op" }, { status: 400 });
  }

  const penalty = await loadRacePenaltyForFaction(loaded.view.id);
  if (!penalty?.active) {
    return NextResponse.json(
      { error: "Сейчас нет активного штрафа grace для этой фракции" },
      { status: 400 },
    );
  }
  const userId = String(body.userId || "");
  if (!penalty.candidates.some((c) => c.userId === userId)) {
    return NextResponse.json(
      { error: "Игрок не в списке кандидатов" },
      { status: 400 },
    );
  }

  const res = await openRacePenaltyAuction({
    factionId: loaded.view.id,
    userId,
    raceWindowId: penalty.windowId,
    actorUserId: loaded.me.id,
    auto: false,
  });
  if (!res.ok) {
    const map: Record<string, string> = {
      not_member: "Игрок уже не в фракции",
      not_member_seat: "Можно выставить только обычного участника",
      already_on_auction: "Игрок уже на аукционе",
      lot_failed: "Не удалось создать лот",
    };
    return NextResponse.json(
      { error: map[res.error] || res.error },
      { status: 400 },
    );
  }
  return NextResponse.json(res);
}
