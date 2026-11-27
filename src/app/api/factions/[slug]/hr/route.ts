import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { loadFactionView } from "@/lib/factions";
import {
  cancelContract,
  expireDueContracts,
  SALARY_PRESETS,
  setPlayerSalaryPct,
  signMonthContract,
} from "@/lib/factionHr";
import { prisma } from "@/lib/prisma";
import { getSelfListStatus } from "@/lib/factionAuction";
import {
  listBalanceFactions,
  listBalancePlayers,
} from "@/lib/factionBalances";

type Ctx = { params: Promise<{ slug: string }> };

async function loadStaff(slugRaw: string) {
  const session = await getServerSession(authOptions);
  const steamId = session?.user?.steamId ?? null;
  const loaded = await loadFactionView(decodeURIComponent(slugRaw), steamId);
  if (loaded.error || !loaded.view) {
    return { error: "notfound" as const, status: 404 as const };
  }
  const staff = Boolean(loaded.view.canManage || loaded.view.keech);
  const member = Boolean(loaded.view.keech || loaded.view.mySeat);
  return { loaded, staff, member, meId: loaded.me?.id ?? null };
}

export async function GET(_req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const gate = await loadStaff(slug);
  if ("error" in gate && gate.error) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  if (!gate.member) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  await expireDueContracts();
  const factionId = gate.loaded.view!.id;
  const members = gate.loaded.view!.members;
  const isKeech = Boolean(gate.loaded.view!.keech);

  const [contracts, salaries, payouts, allFactions, allPlayers] =
    await Promise.all([
      prisma.factionPlayerContract.findMany({
        where: { factionId },
        orderBy: [{ status: "asc" }, { endsAt: "desc" }],
        take: 80,
        include: {
          user: {
            select: { id: true, nick: true, steamName: true, steamId: true },
          },
        },
      }),
      prisma.factionPlayerSalary.findMany({
        where: { factionId },
      }),
      prisma.factionSalaryPayout.findMany({
        where: { factionId },
        orderBy: { createdAt: "desc" },
        take: 300,
        include: {
          user: {
            select: { id: true, nick: true, steamName: true, steamId: true },
          },
        },
      }),
      listBalanceFactions(),
      listBalancePlayers(),
    ]);

  const salaryRows = allFactions.length
    ? await prisma.factionPlayerSalary.findMany({
        where: { factionId: { in: allFactions.map((f) => f.id) } },
        select: { factionId: true, userId: true, pct: true },
      })
    : [];

  const salaryByUser = Object.fromEntries(salaries.map((s) => [s.userId, s.pct]));
  const salaryPctByPair = Object.fromEntries(
    salaryRows.map((s) => [`${s.factionId}:${s.userId}`, s.pct]),
  );
  const activeContractByUser = Object.fromEntries(
    contracts
      .filter((c) => c.status === "ACTIVE" && c.endsAt.getTime() > Date.now())
      .map((c) => [c.userId, c.id]),
  );

  const selfList = await getSelfListStatus(gate.meId);

  return NextResponse.json({
    canManage: gate.staff,
    isKeech,
    myFactionId: factionId,
    treasury: gate.loaded.view!.blueberryBalance,
    salaryPresets: SALARY_PRESETS,
    selfList,
    salaryFactions: allFactions.map((f) => ({
      id: f.id,
      name: f.name,
      slug: f.slug,
      logoUrl: f.logoUrl,
      color: f.color,
    })),
    salaryPlayers: allPlayers.map((p) => ({
      userId: p.userId,
      nick: p.nick,
      seat: p.seat,
      salaryPct: salaryPctByPair[`${p.factionId}:${p.userId}`] ?? 0,
      factionId: p.factionId,
      factionName: p.factionName,
      factionSlug: p.factionSlug,
      factionLogoUrl: p.factionLogoUrl,
      factionColor: p.factionColor,
      canEdit:
        gate.staff && (isKeech || p.factionId === factionId),
    })),
    members: members.map((m) => ({
      userId: m.userId,
      nick: m.nick,
      roleName: m.roleName,
      mainKit: m.mainKit,
      playerValue: m.playerValue,
      salaryPct: salaryByUser[m.userId] ?? 0,
      hasActiveContract: Boolean(activeContractByUser[m.userId]),
    })),
    contracts: contracts.map((c) => ({
      id: c.id,
      userId: c.userId,
      nick: c.user.nick || c.user.steamName || "—",
      steamId: c.user.steamId || "",
      costBd: c.costBd,
      status: c.status,
      startsAt: c.startsAt.toISOString(),
      endsAt: c.endsAt.toISOString(),
      note: c.note,
    })),
    payouts: payouts.map((p) => ({
      id: p.id,
      userId: p.userId,
      nick: p.user.nick || p.user.steamName || "—",
      steamId: p.user.steamId || "",
      windowId: p.windowId,
      pct: p.pct,
      grindBd: p.grindBd,
      paidBd: p.paidBd,
      createdAt: p.createdAt.toISOString(),
    })),
  });
}

export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const gate = await loadStaff(slug);
  if ("error" in gate && gate.error) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  if (!gate.staff || !gate.meId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    op?: string;
    userId?: string;
    contractId?: string;
    factionId?: string;
    pct?: number;
    note?: string;
  };
  const factionId = gate.loaded.view!.id;
  const op = String(body.op || "");

  if (op === "sign_contract") {
    const userId = String(body.userId || "");
    const member = gate.loaded.view!.members.find((m) => m.userId === userId);
    if (!member) return NextResponse.json({ error: "not_member" }, { status: 400 });
    const res = await signMonthContract({
      factionId,
      userId,
      signedByUserId: gate.meId,
      costBd: member.playerValue,
      note: body.note || null,
    });
    if (!res.ok) {
      const map: Record<string, string> = {
        treasury_low: "В казне не хватает B$ на контракт",
        already_contracted: "У игрока уже есть активный контракт",
        not_member: "Игрок не в этой фракции",
        bad_cost: "Некорректная стоимость",
      };
      return NextResponse.json(
        { error: map[res.error] || res.error },
        { status: 400 },
      );
    }
    return NextResponse.json(res);
  }

  if (op === "cancel_contract") {
    const res = await cancelContract({
      contractId: String(body.contractId || ""),
      factionId,
    });
    if (!res.ok) {
      return NextResponse.json({ error: res.error }, { status: 400 });
    }
    return NextResponse.json(res);
  }

  if (op === "set_salary") {
    const targetFactionId = String(body.factionId || factionId).trim() || factionId;
    if (targetFactionId !== factionId && !gate.loaded.view!.keech) {
      return NextResponse.json(
        { error: "ЗП другой фракции — только Keech" },
        { status: 403 },
      );
    }
    const res = await setPlayerSalaryPct({
      factionId: targetFactionId,
      userId: String(body.userId || ""),
      pct: Number(body.pct) || 0,
      updatedBy: gate.meId,
    });
    if (!res.ok) {
      const map: Record<string, string> = {
        bad_pct: "Допустимы 0 или 10–70% шагом 10",
        not_member: "Игрок не в этой фракции",
      };
      return NextResponse.json(
        { error: map[res.error] || res.error },
        { status: 400 },
      );
    }
    return NextResponse.json(res);
  }

  return NextResponse.json({ error: "unknown_op" }, { status: 400 });
}
