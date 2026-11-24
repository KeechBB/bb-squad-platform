import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { loadFactionView } from "@/lib/factions";
import {
  nightBetBoard,
  nightBetHistory,
  placeNightBet,
} from "@/lib/factionNightBets";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string }> };

function isOfficerSeat(seat: string | null | undefined): boolean {
  return seat === "LEADER" || seat === "DEPUTY";
}

export async function GET(req: Request, ctx: Ctx) {
  const session = await getServerSession(authOptions);
  const { slug } = await ctx.params;
  const loaded = await loadFactionView(
    decodeURIComponent(slug),
    session?.user?.steamId ?? null
  );
  if (loaded.error || !loaded.view) {
    return NextResponse.json({ error: "Нет доступа" }, { status: 404 });
  }

  const view = loaded.view;
  const url = new URL(req.url);
  if (url.searchParams.get("history") === "1") {
    const rows = await nightBetHistory(view.id);
    return NextResponse.json({ rows });
  }

  const canPlace = isOfficerSeat(view.mySeat);
  const board = await nightBetBoard({
    viewerFactionId: view.id,
    canPlace,
  });
  return NextResponse.json(board);
}

export async function POST(req: Request, ctx: Ctx) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.steamId) {
    return NextResponse.json({ error: "Нужен вход" }, { status: 401 });
  }
  const { slug } = await ctx.params;
  const loaded = await loadFactionView(
    decodeURIComponent(slug),
    session.user.steamId
  );
  if (loaded.error || !loaded.view) {
    return NextResponse.json({ error: "Нет доступа" }, { status: 404 });
  }
  const view = loaded.view;
  if (!isOfficerSeat(view.mySeat)) {
    return NextResponse.json(
      { error: "Ставить может только глава или зам фракции" },
      { status: 403 }
    );
  }

  const body = (await req.json().catch(() => ({}))) as {
    pickFactionId?: string;
    amount?: number;
  };
  const pickFactionId = String(body.pickFactionId || "").trim();
  const amount = Math.trunc(Number(body.amount) || 0);
  if (!pickFactionId || amount < 1) {
    return NextResponse.json({ error: "Укажи фракцию и сумму" }, { status: 400 });
  }

  const user = await prisma.user.findFirst({
    where: { steamId: session.user.steamId },
    select: { id: true },
  });
  if (!user) {
    return NextResponse.json({ error: "Нет пользователя" }, { status: 401 });
  }

  const result = await placeNightBet({
    actorUserId: user.id,
    actorSteamId: session.user.steamId,
    fromFactionId: view.id,
    pickFactionId,
    amount,
  });

  if (!result.ok) {
    const map: Record<string, string> = {
      min_bet: "Минимальная ставка — 1 000 B$",
      not_member: "Ты не в этой фракции",
      forbidden_seat: "Ставить может только глава или зам",
      bets_not_open: "Ставки ещё не открыты",
      window_closed: "Приём ставок закрыт",
      bad_faction: "Эта фракция не может ставить",
      bad_pick: "Нельзя ставить на эту фракцию",
      insufficient: "В казне не хватает B$",
      debit: "Не удалось списать ставку",
    };
    return NextResponse.json(
      { error: map[result.error] || "Ошибка ставки" },
      { status: 400 }
    );
  }

  const board = await nightBetBoard({
    viewerFactionId: view.id,
    canPlace: true,
  });
  return NextResponse.json({ ok: true, ...board });
}
