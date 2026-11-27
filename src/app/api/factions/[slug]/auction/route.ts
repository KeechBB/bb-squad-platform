import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { loadFactionView } from "@/lib/factions";
import {
  listAuctionBoard,
  openSelfListAuction,
  placeAuctionBid,
  settleDueAuctions,
} from "@/lib/factionAuction";

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const session = await getServerSession(authOptions);
  const loaded = await loadFactionView(
    decodeURIComponent(slug),
    session?.user?.steamId ?? null,
  );
  if (loaded.error || !loaded.view) {
    return NextResponse.json({ error: "notfound" }, { status: 404 });
  }
  if (!loaded.view.keech && !loaded.view.mySeat) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  await settleDueAuctions();
  const board = await listAuctionBoard({ factionId: loaded.view.id });
  return NextResponse.json({
    canManage: Boolean(loaded.view.canManage || loaded.view.keech),
    factionId: loaded.view.id,
    factionName: loaded.view.name,
    treasury: loaded.view.blueberryBalance,
    ...board,
  });
}

export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const session = await getServerSession(authOptions);
  const loaded = await loadFactionView(
    decodeURIComponent(slug),
    session?.user?.steamId ?? null,
  );
  if (loaded.error || !loaded.view) {
    return NextResponse.json({ error: "notfound" }, { status: 404 });
  }
  const meId = loaded.me?.id;
  if (!meId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (!loaded.view.keech && !loaded.view.mySeat) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    op?: string;
    lotId?: string;
    amountBd?: number;
  };
  const op = String(body.op || "bid");

  if (op === "self_list") {
    const res = await openSelfListAuction({
      userId: meId,
      factionId: loaded.view.id,
    });
    if (!res.ok) {
      if (res.error === "contract_active") {
        return NextResponse.json(
          {
            error: "contract_active",
            until: res.until,
            factionName: res.factionName,
            message: `У вас контракт с «${res.factionName}» до ${res.until}. Самовыставление недоступно, пока контракт жив.`,
          },
          { status: 400 },
        );
      }
      const map: Record<string, string> = {
        not_member: "Ты не в этой фракции",
        already_on_auction: "Ты уже на аукционе",
        balance_low:
          "На личном балансе меньше рыночной стоимости — копи B$",
        no_keech: "Сервис временно недоступен",
      };
      return NextResponse.json(
        { error: map[res.error] || res.error },
        { status: 400 },
      );
    }
    return NextResponse.json(res);
  }

  if (!loaded.view.canManage && !loaded.view.keech) {
    return NextResponse.json(
      { error: "Ставки на аукционе — только штаб фракции" },
      { status: 403 },
    );
  }

  if (op === "bid") {
    const res = await placeAuctionBid({
      lotId: String(body.lotId || ""),
      factionId: loaded.view.id,
      amountBd: Number(body.amountBd) || 0,
      placedByUserId: meId,
    });
    if (!res.ok) {
      const map: Record<string, string> = {
        treasury_low: "В казне не хватает B$",
        not_higher: "Ставка должна быть выше вашей текущей",
        below_leader: "Ставка должна быть выше лидера торгов",
        below_min: "Ставка ниже рыночного минимума лота",
        lot_closed: "Лот уже закрыт",
        lot_ended: "Время лота вышло",
        faction_not_allowed: "Эта фракция не участвует в аукционе",
        bad_amount: "Некорректная сумма",
      };
      return NextResponse.json(
        { error: map[res.error] || res.error },
        { status: 400 },
      );
    }
    return NextResponse.json(res);
  }

  if (op === "settle") {
    const n = await settleDueAuctions();
    return NextResponse.json({ ok: true, settled: n });
  }

  return NextResponse.json({ error: "unknown_op" }, { status: 400 });
}
