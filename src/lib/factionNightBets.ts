/**
 * Ставки фракций на ночной гринд B$ (тренировка ~21:00–01:00 МСК).
 * Окно = training-day YMD: вечер 24.11 + ночь до ~01:00 25.11 → id 2026-11-24.
 * Пари-мутель: казны ставят на фракцию-лидера гринда; победители делят банк.
 */
import { prisma } from "@/lib/prisma";
import { factionUiColor } from "@/lib/factionColors";
import { parseFactionInfo } from "@/lib/factionInfoDoc";
import {
  RACE_FACTION_NAMES,
  isRaceExcludedName,
} from "@/lib/factionRaceCanon";
import { trainingDayYmd } from "@/lib/squadSessions";
import { isBuiltinSuperAdmin } from "@/lib/admin";
import { BD_MARK } from "@/lib/blueberryDollar";

export const NIGHT_BET_MIN = 1_000;

export type NightBetWindowBounds = {
  id: string;
  start: Date;
  end: Date;
};

function pad2(n: number) {
  return n < 10 ? `0${n}` : String(n);
}

function parseYmd(ymd: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || "").trim());
  if (!m) return null;
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

/** Границы ночной тренировки: 21:00 МСК → 01:00 МСК след. календарного дня. */
export function nightBetBoundsForDay(ymd: string): NightBetWindowBounds | null {
  const p = parseYmd(ymd);
  if (!p) return null;
  // 21:00 МСК = 18:00 UTC; 01:00 МСК след. дня = 22:00 UTC того же UTC-дня YMD
  const start = new Date(Date.UTC(p.y, p.m - 1, p.d, 18, 0, 0));
  const end = new Date(Date.UTC(p.y, p.m - 1, p.d, 22, 0, 0));
  return { id: ymd, start, end };
}

/** Текущее/ближайшее окно по training-day (после полуночи до полудня — вчерашняя ночь). */
export function nightBetWindowAt(now = new Date()): NightBetWindowBounds {
  const id = trainingDayYmd(now);
  const bounds = nightBetBoundsForDay(id);
  if (!bounds) {
    // fallback — сегодняшняя дата МСК через trainingDayYmd всегда валидна
    const fallback = nightBetBoundsForDay("2026-11-24")!;
    return fallback;
  }
  return bounds;
}

export function formatNightBetLabel(bounds: NightBetWindowBounds): string {
  const fmt = (d: Date) =>
    new Intl.DateTimeFormat("ru-RU", {
      timeZone: "Europe/Moscow",
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(d);
  return `${fmt(bounds.start)} — ${fmt(bounds.end)} МСК · ночной гринд`;
}

async function listBetFactions() {
  const bb = await prisma.clan.findFirst({
    where: { tag: "BB", isExternal: false },
    select: { id: true },
  });
  if (!bb) return [];
  const all = await prisma.faction.findMany({
    where: { clanId: bb.id, name: { in: [...RACE_FACTION_NAMES] } },
    select: {
      id: true,
      name: true,
      slug: true,
      blueberryBalance: true,
      info: true,
    },
    orderBy: { name: "asc" },
  });
  return all.filter((f) => !isRaceExcludedName(f.name, f.slug));
}

function matchOverlapsWindow(
  startedAt: Date | null,
  endedAt: Date | null,
  start: Date,
  end: Date
): boolean {
  const a = (startedAt || endedAt)?.getTime();
  const b = (endedAt || startedAt)?.getTime();
  if (a == null || b == null || !Number.isFinite(a) || !Number.isFinite(b)) {
    return false;
  }
  // +15 мин к концу: катка, закончившаяся ~01:00–01:15, остаётся в этой ночи
  const endPad = end.getTime() + 15 * 60_000;
  return a < endPad && b >= start.getTime();
}

/** Сумма гринда фракции за ночное окно (по CanonMatch, не по createdAt ledger). */
export async function nightGrindSums(
  factionIds: string[],
  bounds: NightBetWindowBounds
): Promise<Map<string, number>> {
  const out = new Map<string, number>(factionIds.map((id) => [id, 0]));
  if (!factionIds.length) return out;

  const matches = await prisma.canonMatch.findMany({
    where: {
      kind: "TRAIN",
      OR: [
        {
          startedAt: {
            gte: new Date(bounds.start.getTime() - 60 * 60_000),
            lt: new Date(bounds.end.getTime() + 2 * 60 * 60_000),
          },
        },
        {
          endedAt: {
            gte: new Date(bounds.start.getTime() - 60 * 60_000),
            lt: new Date(bounds.end.getTime() + 2 * 60 * 60_000),
          },
        },
      ],
    },
    select: { id: true, startedAt: true, endedAt: true },
  });

  const matchIds = matches
    .filter((m) => {
      const t = m.startedAt || m.endedAt;
      if (!t) return false;
      if (trainingDayYmd(t) !== bounds.id) return false;
      return matchOverlapsWindow(m.startedAt, m.endedAt, bounds.start, bounds.end);
    })
    .map((m) => m.id);

  if (!matchIds.length) return out;

  const agg = await prisma.factionLedgerEntry.groupBy({
    by: ["factionId"],
    where: {
      factionId: { in: factionIds },
      kind: "grind",
      amount: { gt: 0 },
      matchId: { in: matchIds },
    },
    _sum: { amount: true },
  });
  for (const row of agg) {
    out.set(row.factionId, Math.max(0, row._sum.amount || 0));
  }
  return out;
}

async function ensureWindow(bounds: NightBetWindowBounds) {
  return prisma.factionNightBetWindow.upsert({
    where: { id: bounds.id },
    create: {
      id: bounds.id,
      startAt: bounds.start,
      endAt: bounds.end,
      status: "open",
      pot: 0,
    },
    update: {
      startAt: bounds.start,
      endAt: bounds.end,
    },
  });
}

function pickWinners(grind: Map<string, number>): string[] {
  let best = -1;
  for (const v of grind.values()) {
    if (v > best) best = v;
  }
  if (best <= 0) return [];
  return [...grind.entries()].filter(([, v]) => v === best).map(([id]) => id);
}

/** Пари-мутель: победители делят банк пропорционально ставкам. */
function calcPayouts(
  bets: { id: string; amount: number; pickFactionId: string }[],
  winnerIds: string[],
  pot: number
): Map<string, number> {
  const payouts = new Map<string, number>();
  if (!bets.length) return payouts;
  if (!winnerIds.length || pot <= 0) {
    // пуш — возврат
    for (const b of bets) payouts.set(b.id, b.amount);
    return payouts;
  }
  const winSet = new Set(winnerIds);
  const winners = bets.filter((b) => winSet.has(b.pickFactionId));
  if (!winners.length) {
    for (const b of bets) payouts.set(b.id, b.amount);
    return payouts;
  }
  const winStake = winners.reduce((s, b) => s + b.amount, 0);
  if (winStake <= 0) {
    for (const b of bets) payouts.set(b.id, b.amount);
    return payouts;
  }
  let distributed = 0;
  const sorted = [...winners].sort((a, b) => b.amount - a.amount);
  for (let i = 0; i < sorted.length; i++) {
    const b = sorted[i]!;
    let pay =
      i === sorted.length - 1
        ? pot - distributed
        : Math.floor((b.amount / winStake) * pot);
    if (pay < 0) pay = 0;
    payouts.set(b.id, pay);
    distributed += pay;
  }
  for (const b of bets) {
    if (!payouts.has(b.id)) payouts.set(b.id, 0);
  }
  return payouts;
}

export async function settleNightBetWindow(
  bounds: NightBetWindowBounds,
  now = new Date()
): Promise<void> {
  if (now.getTime() < bounds.end.getTime()) return;
  const win = await ensureWindow(bounds);
  if (win.status === "settled") return;

  const factions = await listBetFactions();
  const ids = factions.map((f) => f.id);
  const grind = await nightGrindSums(ids, bounds);
  const winnerIds = pickWinners(grind);

  const bets = await prisma.factionNightBet.findMany({
    where: { windowId: bounds.id, status: "pending" },
  });
  const pot = bets.reduce((s, b) => s + b.amount, 0);
  const payouts = calcPayouts(
    bets.map((b) => ({
      id: b.id,
      amount: b.amount,
      pickFactionId: b.pickFactionId,
    })),
    winnerIds,
    pot
  );

  await prisma.$transaction(async (tx) => {
    const fresh = await tx.factionNightBetWindow.findUnique({
      where: { id: bounds.id },
    });
    if (!fresh || fresh.status === "settled") return;

    for (const b of bets) {
      const pay = payouts.get(b.id) ?? 0;
      const winSet = new Set(winnerIds);
      let status: string;
      if (!winnerIds.length || pot <= 0) status = "refunded";
      else if (!bets.some((x) => winSet.has(x.pickFactionId))) status = "refunded";
      else if (winSet.has(b.pickFactionId)) status = "won";
      else status = "lost";

      await tx.factionNightBet.update({
        where: { id: b.id },
        data: { status, payout: pay },
      });

      if (pay > 0) {
        const sourceKey = `night_bet_payout:${bounds.id}:${b.id}`;
        const note =
          status === "refunded"
            ? `Возврат ставки ${pay.toLocaleString("ru-RU")} ${BD_MARK} (ночь ${bounds.id})`
            : `Выигрыш ставки ${pay.toLocaleString("ru-RU")} ${BD_MARK} (ночь ${bounds.id})`;
        await tx.factionLedgerEntry.create({
          data: {
            factionId: b.fromFactionId,
            amount: pay,
            kind: status === "refunded" ? "night_bet_refund" : "night_bet_win",
            sourceKey,
            note,
            userId: b.placedByUserId,
          },
        });
        await tx.faction.update({
          where: { id: b.fromFactionId },
          data: { blueberryBalance: { increment: pay } },
        });
      }
    }

    await tx.factionNightBetWindow.update({
      where: { id: bounds.id },
      data: {
        status: "settled",
        pot,
        winnerFactionIds: winnerIds,
        settledAt: now,
      },
    });
  });
}

export type NightBetBoard = {
  label: string;
  windowId: string;
  startIso: string;
  endIso: string;
  status: "upcoming" | "live" | "settled";
  canBet: boolean;
  myFactionId: string | null;
  myTreasury: number;
  pot: number;
  minBet: number;
  grind: {
    factionId: string;
    name: string;
    slug: string;
    color: string;
    font: string;
    amount: number;
  }[];
  bets: {
    id: string;
    fromFactionId: string;
    fromName: string;
    fromColor: string;
    pickFactionId: string;
    pickName: string;
    pickColor: string;
    amount: number;
    status: string;
    payout: number;
    placedByNick: string;
  }[];
  myBet: {
    pickFactionId: string;
    amount: number;
    status: string;
    payout: number;
  } | null;
  winners: { factionId: string; name: string; color: string }[];
};

export async function nightBetBoard(opts: {
  viewerFactionId: string | null;
  canPlace: boolean;
  now?: Date;
}): Promise<NightBetBoard> {
  const now = opts.now || new Date();
  const bounds = nightBetWindowAt(now);
  await ensureWindow(bounds);

  if (now.getTime() >= bounds.end.getTime()) {
    await settleNightBetWindow(bounds, now).catch((e) =>
      console.error("night bet settle", e)
    );
  }

  const win = await prisma.factionNightBetWindow.findUnique({
    where: { id: bounds.id },
  });
  const factions = await listBetFactions();
  const ids = factions.map((f) => f.id);
  const grindMap = await nightGrindSums(ids, bounds);

  const phase: NightBetBoard["status"] =
    win?.status === "settled"
      ? "settled"
      : now.getTime() < bounds.start.getTime()
        ? "upcoming"
        : now.getTime() < bounds.end.getTime()
          ? "live"
          : "settled";

  const bets = await prisma.factionNightBet.findMany({
    where: { windowId: bounds.id },
    include: {
      fromFaction: { select: { id: true, name: true, slug: true, info: true } },
      pickFaction: { select: { id: true, name: true, slug: true, info: true } },
      placedBy: { select: { nick: true, name: true, steamName: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  const pot =
    win?.status === "settled"
      ? win.pot
      : bets.reduce((s, b) => s + b.amount, 0);

  const grind = factions
    .map((f) => {
      const info = parseFactionInfo(f.info);
      return {
        factionId: f.id,
        name: f.name,
        slug: f.slug,
        color: factionUiColor(f.name, f.slug),
        font: info.font || "Oxanium",
        amount: grindMap.get(f.id) || 0,
      };
    })
    .sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name, "ru"));

  const winnerIds =
    win?.status === "settled"
      ? win.winnerFactionIds
      : pickWinners(grindMap);
  const winners = winnerIds
    .map((id) => {
      const f = factions.find((x) => x.id === id);
      if (!f) return null;
      return {
        factionId: f.id,
        name: f.name,
        color: factionUiColor(f.name, f.slug),
      };
    })
    .filter(Boolean) as NightBetBoard["winners"];

  const myFaction = opts.viewerFactionId
    ? factions.find((f) => f.id === opts.viewerFactionId)
    : null;
  const myBetRow = opts.viewerFactionId
    ? bets.find((b) => b.fromFactionId === opts.viewerFactionId)
    : null;

  const canBet =
    Boolean(opts.canPlace && opts.viewerFactionId && myFaction) &&
    (win?.status || "open") !== "settled" &&
    now.getTime() < bounds.end.getTime();

  return {
    label: formatNightBetLabel(bounds),
    windowId: bounds.id,
    startIso: bounds.start.toISOString(),
    endIso: bounds.end.toISOString(),
    status: phase,
    canBet,
    myFactionId: opts.viewerFactionId,
    myTreasury: Math.max(0, myFaction?.blueberryBalance || 0),
    pot,
    minBet: NIGHT_BET_MIN,
    grind,
    bets: bets.map((b) => ({
      id: b.id,
      fromFactionId: b.fromFactionId,
      fromName: b.fromFaction.name,
      fromColor: factionUiColor(b.fromFaction.name, b.fromFaction.slug),
      pickFactionId: b.pickFactionId,
      pickName: b.pickFaction.name,
      pickColor: factionUiColor(b.pickFaction.name, b.pickFaction.slug),
      amount: b.amount,
      status: b.status,
      payout: b.payout,
      placedByNick:
        b.placedBy.nick || b.placedBy.steamName || b.placedBy.name || "—",
    })),
    myBet: myBetRow
      ? {
          pickFactionId: myBetRow.pickFactionId,
          amount: myBetRow.amount,
          status: myBetRow.status,
          payout: myBetRow.payout,
        }
      : null,
    winners,
  };
}

export async function placeNightBet(opts: {
  actorUserId: string;
  actorSteamId: string | null;
  fromFactionId: string;
  pickFactionId: string;
  amount: number;
}): Promise<{ ok: true; boardHint?: string } | { ok: false; error: string }> {
  const amount = Math.trunc(Number(opts.amount) || 0);
  if (amount < NIGHT_BET_MIN) return { ok: false, error: "min_bet" };

  const keech = Boolean(
    opts.actorSteamId && isBuiltinSuperAdmin(opts.actorSteamId)
  );
  const mem = await prisma.factionMember.findUnique({
    where: { userId: opts.actorUserId },
    select: { factionId: true, seat: true },
  });
  if (!keech) {
    if (!mem || mem.factionId !== opts.fromFactionId) {
      return { ok: false, error: "not_member" };
    }
    if (mem.seat !== "LEADER" && mem.seat !== "DEPUTY") {
      return { ok: false, error: "forbidden_seat" };
    }
  }

  const bounds = nightBetWindowAt();
  const now = new Date();
  if (now.getTime() >= bounds.end.getTime()) {
    await settleNightBetWindow(bounds, now).catch(() => {});
    return { ok: false, error: "window_closed" };
  }

  const factions = await listBetFactions();
  const from = factions.find((f) => f.id === opts.fromFactionId);
  const pick = factions.find((f) => f.id === opts.pickFactionId);
  if (!from || !pick) return { ok: false, error: "bad_faction" };

  await ensureWindow(bounds);
  const win = await prisma.factionNightBetWindow.findUnique({
    where: { id: bounds.id },
  });
  if (!win || win.status === "settled") return { ok: false, error: "window_closed" };

  const existing = await prisma.factionNightBet.findUnique({
    where: {
      windowId_fromFactionId: {
        windowId: bounds.id,
        fromFactionId: opts.fromFactionId,
      },
    },
  });

  try {
    await prisma.$transaction(async (tx) => {
      const f = await tx.faction.findUnique({
        where: { id: opts.fromFactionId },
        select: { blueberryBalance: true },
      });
      if (!f) throw new Error("faction");
      let treasury = Math.max(0, f.blueberryBalance || 0);

      if (existing && existing.status === "pending") {
        // вернуть старую ставку в казну, затем списать новую
        treasury += existing.amount;
        await tx.factionLedgerEntry.create({
          data: {
            factionId: opts.fromFactionId,
            amount: existing.amount,
            kind: "night_bet_refund",
            sourceKey: `night_bet_replace_refund:${bounds.id}:${existing.id}`,
            note: `Замена ставки: возврат ${existing.amount.toLocaleString("ru-RU")} ${BD_MARK}`,
            userId: opts.actorUserId,
          },
        });
        await tx.factionNightBet.delete({ where: { id: existing.id } });
      }

      if (treasury < amount) throw new Error("insufficient");
      const next = treasury - amount;

      const bet = await tx.factionNightBet.create({
        data: {
          windowId: bounds.id,
          fromFactionId: opts.fromFactionId,
          pickFactionId: opts.pickFactionId,
          amount,
          placedByUserId: opts.actorUserId,
          status: "pending",
        },
      });

      await tx.factionLedgerEntry.create({
        data: {
          factionId: opts.fromFactionId,
          amount: -amount,
          kind: "night_bet",
          sourceKey: `night_bet:${bounds.id}:${bet.id}`,
          note: `Ставка ${amount.toLocaleString("ru-RU")} ${BD_MARK} на «${pick.name}» (ночь ${bounds.id})`,
          userId: opts.actorUserId,
        },
      });
      await tx.faction.update({
        where: { id: opts.fromFactionId },
        data: { blueberryBalance: next },
      });

      const all = await tx.factionNightBet.findMany({
        where: { windowId: bounds.id, status: "pending" },
        select: { amount: true },
      });
      await tx.factionNightBetWindow.update({
        where: { id: bounds.id },
        data: { pot: all.reduce((s, b) => s + b.amount, 0) },
      });
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "insufficient") return { ok: false, error: "insufficient" };
    console.error("placeNightBet", e);
    return { ok: false, error: "debit" };
  }

  return { ok: true };
}

/** Для отладки / отчёта — не экспортировать лишнее в UI. */
export function nightBetDebugLabel(ymd: string) {
  const b = nightBetBoundsForDay(ymd);
  if (!b) return ymd;
  return `${b.id} ${pad2(b.start.getUTCHours())}:${pad2(b.start.getUTCMinutes())}Z→${pad2(b.end.getUTCHours())}:${pad2(b.end.getUTCMinutes())}Z`;
}
