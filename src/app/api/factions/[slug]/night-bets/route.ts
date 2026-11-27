import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { loadFactionView } from "@/lib/factions";
import {
  forceCloseNightTraining,
  nightBetBoard,
  nightBetHistory,
  nightBetWinsHistory,
  nightFactionGrindDayHistory,
  nightGrindPlayers,
  placeNightBet,
  type NightBetSource,
} from "@/lib/factionNightBets";
import { prisma } from "@/lib/prisma";
import { isBuiltinSuperAdmin } from "@/lib/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string }> };

function isOfficerSeat(seat: string | null | undefined): boolean {
  return seat === "LEADER" || seat === "DEPUTY";
}

function isMemberSeat(seat: string | null | undefined): boolean {
  return seat === "LEADER" || seat === "DEPUTY" || seat === "MEMBER";
}

async function sessionUserId(steamId: string): Promise<string | null> {
  const user = await prisma.user.findFirst({
    where: { steamId },
    select: { id: true },
  });
  return user?.id || null;
}

function boardOpts(view: {
  id: string;
  mySeat: string | null;
}, opts: { userId: string | null; keech: boolean }) {
  const officer = isOfficerSeat(view.mySeat);
  const member = isMemberSeat(view.mySeat) || opts.keech;
  return {
    viewerFactionId: view.id,
    viewerUserId: opts.userId,
    isMember: member,
    canPlaceTreasury: officer || opts.keech,
    canPlace: member,
    isKeech: opts.keech,
  };
}

export async function GET(req: Request, ctx: Ctx) {
  const session = await getServerSession(authOptions);
  const { slug } = await ctx.params;
  const steamId = session?.user?.steamId ?? null;
  const loaded = await loadFactionView(decodeURIComponent(slug), steamId);
  if (loaded.error || !loaded.view) {
    return NextResponse.json({ error: "Нет доступа" }, { status: 404 });
  }

  const view = loaded.view;
  const keech = Boolean(steamId && isBuiltinSuperAdmin(steamId));
  const userId = steamId ? await sessionUserId(steamId) : null;

  const url = new URL(req.url);
  if (url.searchParams.get("history") === "1") {
    const rows = await nightBetHistory();
    return NextResponse.json({ rows });
  }

  if (url.searchParams.get("wins") === "1") {
    const rows = await nightBetWinsHistory();
    return NextResponse.json({ rows });
  }

  if (url.searchParams.get("grindDays") === "1") {
    const days = await nightFactionGrindDayHistory({ days: 45 });
    return NextResponse.json({ days });
  }

  const grindFactionId = String(url.searchParams.get("grindPlayers") || "").trim();
  if (grindFactionId) {
    const detail = await nightGrindPlayers(grindFactionId);
    if (!detail) {
      return NextResponse.json({ error: "Фракция не найдена" }, { status: 404 });
    }
    return NextResponse.json(detail);
  }

  const board = await nightBetBoard(boardOpts(view, { userId, keech }));
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
  const keech = isBuiltinSuperAdmin(session.user.steamId);

  const body = (await req.json().catch(() => ({}))) as {
    action?: string;
    pickFactionId?: string;
    amount?: number;
    source?: string;
  };

  const userId = await sessionUserId(session.user.steamId);
  if (!userId) {
    return NextResponse.json({ error: "Нет пользователя" }, { status: 401 });
  }

  // Досрочный итог тренировки — только Keech (кнопка только у него).
  if (String(body.action || "").trim() === "closeTraining") {
    if (!keech) {
      return NextResponse.json({ error: "Нет доступа" }, { status: 403 });
    }
    const closed = await forceCloseNightTraining();
    if (!closed.ok) {
      const map: Record<string, string> = {
        grind_not_started: "Гринд ещё не начался (после 21:00 МСК)",
        settle_failed: "Не удалось закрыть тренировку",
      };
      return NextResponse.json(
        { error: map[closed.error] || "Ошибка закрытия" },
        { status: 400 }
      );
    }
    const board = await nightBetBoard(boardOpts(view, { userId, keech: true }));
    return NextResponse.json({
      ok: true,
      closed: true,
      alreadySettled: Boolean(closed.alreadySettled),
      ...board,
    });
  }

  const officer = isOfficerSeat(view.mySeat);
  const member = isMemberSeat(view.mySeat) || keech;
  if (!member) {
    return NextResponse.json(
      { error: "Ставить может только участник фракции" },
      { status: 403 }
    );
  }

  const rawSource = String(body.source || "").trim().toLowerCase();
  let source: NightBetSource;
  if (keech) {
    source = "personal";
  } else if (rawSource === "treasury") {
    if (!officer) {
      return NextResponse.json(
        { error: "Из казны может ставить только глава или зам" },
        { status: 403 }
      );
    }
    source = "treasury";
  } else if (rawSource === "personal") {
    source = "personal";
  } else {
    source = officer ? "treasury" : "personal";
  }

  const pickFactionId = String(body.pickFactionId || "").trim();
  const amount = Math.trunc(Number(body.amount) || 0);
  if (!pickFactionId || amount < 1) {
    return NextResponse.json({ error: "Укажи фракцию и сумму" }, { status: 400 });
  }

  const result = await placeNightBet({
    actorUserId: userId,
    actorSteamId: session.user.steamId,
    fromFactionId: view.id,
    pickFactionId,
    amount,
    source,
  });

  if (!result.ok) {
    const map: Record<string, string> = {
      min_bet: "Минимальная ставка — 1 B$",
      not_member: "Ты не в этой фракции",
      forbidden_seat: "Из казны может ставить только глава или зам",
      bets_not_open: "Ставки ещё не открыты",
      window_closed: "Приём ставок закрыт (до 21:30 МСК)",
      bad_faction: "Эта фракция не может ставить",
      bad_pick: "Нельзя ставить на эту фракцию",
      insufficient: "В казне не хватает B$",
      insufficient_personal: "На личном балансе не хватает B$",
      debit: "Не удалось списать ставку",
    };
    return NextResponse.json(
      { error: map[result.error] || "Ошибка ставки" },
      { status: 400 }
    );
  }

  const board = await nightBetBoard(boardOpts(view, { userId, keech }));
  return NextResponse.json({ ok: true, ...board });
}
