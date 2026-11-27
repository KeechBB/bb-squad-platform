/**
 * Ставки фракций на ночной гринд B$ (как букмекер / пари-мутель).
 *
 * День окна = training-day YMD (вечер 24.11 + ночь до ~01:00 25.11 → id 2026-11-24).
 * Приём ставок: 12:00–21:30 МСК. Учёт гринда: 21:00–01:00 МСК.
 * Банк = только поставленные B$; выплата пропорциональна доле ставки на победителя.
 * Легион может ставить со стороны, в забеге гринда не участвует.
 */
import { prisma } from "@/lib/prisma";
import { factionUiColor } from "@/lib/factionColors";
import { parseFactionInfo } from "@/lib/factionInfoDoc";
import {
  RACE_FACTION_NAMES,
  isRaceExcludedName,
} from "@/lib/factionRaceCanon";
import { trainingDayYmd } from "@/lib/squadSessions";
import { BD_MARK } from "@/lib/blueberryDollar";
import { isBuiltinSuperAdmin } from "@/lib/admin";

/** Любая сумма от 1 B$ (раньше было 1000). */
export const NIGHT_BET_MIN = 1;
export const KEECH_BET_NAME = "Кич";
export const KEECH_BET_COLOR = "#fbbf24";
export type NightBetSource = "treasury" | "personal";

export type NightBetWindowBounds = {
  id: string;
  /** 12:00 МСК */
  betsOpen: Date;
  /** 21:30 МСК */
  betsClose: Date;
  /** 21:00 МСК */
  grindStart: Date;
  /** 01:00 МСК след. календарного дня */
  grindEnd: Date;
};

function parseYmd(ymd: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || "").trim());
  if (!m) return null;
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

/** Границы дня: ставки 12:00–21:30, гринд 21:00–01:00 МСК. */
export function nightBetBoundsForDay(ymd: string): NightBetWindowBounds | null {
  const p = parseYmd(ymd);
  if (!p) return null;
  // МСК = UTC+3
  const betsOpen = new Date(Date.UTC(p.y, p.m - 1, p.d, 9, 0, 0)); // 12:00
  const grindStart = new Date(Date.UTC(p.y, p.m - 1, p.d, 18, 0, 0)); // 21:00
  const betsClose = new Date(Date.UTC(p.y, p.m - 1, p.d, 18, 30, 0)); // 21:30
  const grindEnd = new Date(Date.UTC(p.y, p.m - 1, p.d, 22, 0, 0)); // 01:00 след.
  return { id: ymd, betsOpen, betsClose, grindStart, grindEnd };
}

/** Текущее окно по training-day (до 12:00 МСК — вчерашняя ночь / итоги). */
export function nightBetWindowAt(now = new Date()): NightBetWindowBounds {
  const id = trainingDayYmd(now);
  return nightBetBoundsForDay(id) || nightBetBoundsForDay("2026-11-24")!;
}

/** Заголовок вкладки ставок (дата тренировки — в bounds.id). */
export function formatNightBetLabel(_bounds: NightBetWindowBounds): string {
  return "Ставка на тренировку, кто из фракций больше всего заработает Долларов за тренировку. Окно ставок с 12:00, приём до 21:30.";
}

/** Короткая дата дня для истории: «24.11.2026». */
export function formatNightBetDayLabel(bounds: NightBetWindowBounds): string {
  const p = parseYmd(bounds.id);
  if (!p) return bounds.id;
  const dd = p.d < 10 ? `0${p.d}` : String(p.d);
  const mm = p.m < 10 ? `0${p.m}` : String(p.m);
  return `${dd}.${mm}.${p.y}`;
}

type FactionLite = {
  id: string;
  name: string;
  slug: string;
  blueberryBalance: number;
  info: string | null;
};

async function listBbClanId(): Promise<string | null> {
  const bb = await prisma.clan.findFirst({
    where: { tag: "BB", isExternal: false },
    select: { id: true },
  });
  return bb?.id || null;
}

/** Фракции забега (без Легиона) — на них ставят и по ним считают гринд. */
async function listGrindFactions(): Promise<FactionLite[]> {
  const clanId = await listBbClanId();
  if (!clanId) return [];
  const all = await prisma.faction.findMany({
    where: { clanId, name: { in: [...RACE_FACTION_NAMES] } },
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

/** Кто может ставить: забег + Легион. */
async function listBettorFactions(): Promise<FactionLite[]> {
  const clanId = await listBbClanId();
  if (!clanId) return [];
  const all = await prisma.faction.findMany({
    where: {
      clanId,
      OR: [
        { name: { in: [...RACE_FACTION_NAMES] } },
        { name: { equals: "Легион", mode: "insensitive" } },
        { slug: { contains: "legion", mode: "insensitive" } },
        { slug: { contains: "legiyon", mode: "insensitive" } },
      ],
    },
    select: {
      id: true,
      name: true,
      slug: true,
      blueberryBalance: true,
      info: true,
    },
    orderBy: { name: "asc" },
  });
  const grind = all.filter((f) => !isRaceExcludedName(f.name, f.slug));
  const legion = all.filter((f) => isRaceExcludedName(f.name, f.slug));
  const byId = new Map<string, FactionLite>();
  for (const f of [...grind, ...legion]) byId.set(f.id, f);
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, "ru"));
}

/**
 * Сумма гринда за ночь (21:00–01:00 МСК).
 * Считаем по factionLedgerEntry.createdAt — у TRAIN в CanonMatch
 * startedAt/endedAt часто null, а кредиты пишутся в момент оцифровки карты.
 */
export async function nightGrindSums(
  factionIds: string[],
  bounds: NightBetWindowBounds
): Promise<Map<string, number>> {
  const out = new Map<string, number>(factionIds.map((id) => [id, 0]));
  if (!factionIds.length) return out;

  const agg = await prisma.factionLedgerEntry.groupBy({
    by: ["factionId"],
    where: {
      factionId: { in: factionIds },
      kind: "grind",
      amount: { gt: 0 },
      createdAt: { gte: bounds.grindStart, lt: bounds.grindEnd },
    },
    _sum: { amount: true },
  });
  for (const row of agg) {
    out.set(row.factionId, Math.max(0, row._sum.amount || 0));
  }
  return out;
}

export type NightGrindPlayerRow = {
  userId: string | null;
  nick: string;
  amount: number;
};

/** Ник из note вида «TR tr1 · Harju RAAS v2 · Durik» / «… · ZoZo · SL». */
function nickFromGrindNote(note: string | null | undefined): string | null {
  const raw = String(note || "").trim();
  if (!raw) return null;
  const parts = raw.split("·").map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const roleTok = /^(SL|LAT|HAT|AR|MED|ENG|CREW|PILOT|CMD|RL)$/i;
  let seg = parts[parts.length - 1]!;
  if (roleTok.test(seg.split(/\s+/)[0] || "") && parts.length >= 3) {
    seg = parts[parts.length - 2]!;
  }
  const nick = seg.split(/\s+/)[0]?.trim();
  return nick || null;
}

/** Кто сколько нафармил в казну фракции за окно гринда. */
export async function nightGrindPlayers(
  factionId: string,
  bounds?: NightBetWindowBounds
): Promise<{
  factionId: string;
  factionName: string;
  color: string;
  total: number;
  players: NightGrindPlayerRow[];
} | null> {
  const id = String(factionId || "").trim();
  if (!id) return null;
  const factions = await listGrindFactions();
  const faction = factions.find((f) => f.id === id);
  if (!faction) return null;
  const win = bounds || nightBetWindowAt();

  const entries = await prisma.factionLedgerEntry.findMany({
    where: {
      factionId: id,
      kind: "grind",
      amount: { gt: 0 },
      createdAt: { gte: win.grindStart, lt: win.grindEnd },
    },
    select: { userId: true, amount: true, note: true },
  });

  const byUser = new Map<string, { amount: number; noteNick: string | null }>();
  let orphan = 0;
  for (const e of entries) {
    const amt = Math.max(0, e.amount || 0);
    if (!amt) continue;
    if (!e.userId) {
      orphan += amt;
      continue;
    }
    const prev = byUser.get(e.userId) || {
      amount: 0,
      noteNick: null as string | null,
    };
    prev.amount += amt;
    if (!prev.noteNick) prev.noteNick = nickFromGrindNote(e.note);
    byUser.set(e.userId, prev);
  }

  const userIds = [...byUser.keys()];
  const users = userIds.length
    ? await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, nick: true, steamName: true, name: true },
      })
    : [];
  const userBy = new Map(users.map((u) => [u.id, u]));

  const players: NightGrindPlayerRow[] = [];
  for (const [uid, row] of byUser) {
    const u = userBy.get(uid);
    const nick =
      (u?.nick && String(u.nick).trim()) ||
      (u?.steamName && String(u.steamName).trim()) ||
      (u?.name && String(u.name).trim()) ||
      row.noteNick ||
      "Игрок";
    players.push({ userId: uid, nick, amount: row.amount });
  }
  if (orphan > 0) {
    players.push({ userId: null, nick: "Без привязки", amount: orphan });
  }
  players.sort(
    (a, b) => b.amount - a.amount || a.nick.localeCompare(b.nick, "ru")
  );
  const total = players.reduce((s, p) => s + p.amount, 0);
  const info = parseFactionInfo(faction.info);
  return {
    factionId: faction.id,
    factionName: faction.name,
    color: factionUiColor(faction.name, faction.slug, info.color),
    total,
    players,
  };
}

async function ensureWindow(bounds: NightBetWindowBounds) {
  return prisma.factionNightBetWindow.upsert({
    where: { id: bounds.id },
    create: {
      id: bounds.id,
      startAt: bounds.betsOpen,
      endAt: bounds.grindEnd,
      status: "open",
      pot: 0,
    },
    update: {
      startAt: bounds.betsOpen,
      endAt: bounds.grindEnd,
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

/** Десятичный кэф: банк / сумма ставок на исход. Все на одну → ~1.00 */
export function decimalOdds(pot: number, stakeOnPick: number): number | null {
  if (pot <= 0 || stakeOnPick <= 0) return null;
  return Math.round((pot / stakeOnPick) * 100) / 100;
}

function stakeByPick(
  bets: { pickFactionId: string; amount: number }[]
): Map<string, number> {
  const m = new Map<string, number>();
  for (const b of bets) {
    m.set(b.pickFactionId, (m.get(b.pickFactionId) || 0) + b.amount);
  }
  return m;
}

/** Пари-мутель: весь банк делится между угадавшими пропорционально их ставкам. */
function calcPayouts(
  bets: { id: string; amount: number; pickFactionId: string }[],
  winnerIds: string[],
  pot: number
): Map<string, number> {
  const payouts = new Map<string, number>();
  if (!bets.length) return payouts;
  if (!winnerIds.length || pot <= 0) {
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
  now = new Date(),
  opts?: { force?: boolean }
): Promise<{ settled: boolean; reason?: string }> {
  // Обычный cron — только после 01:00. force — ручное «закрыть тренировку» (Keech).
  if (!opts?.force && now.getTime() < bounds.grindEnd.getTime()) {
    return { settled: false, reason: "before_01:00" };
  }
  const win = await ensureWindow(bounds);
  if (win.status === "settled") return { settled: false, reason: "already_settled" };

  const factions = await listGrindFactions();
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
        if (b.isPersonal || !b.fromFactionId) {
          // Keech: безлимит, кошелёк не трогаем. Остальные личные — на User.blueberryBalance.
          const placer = await tx.user.findUnique({
            where: { id: b.placedByUserId },
            select: { steamId: true },
          });
          if (placer?.steamId && isBuiltinSuperAdmin(placer.steamId)) {
            // no-op
          } else {
            await tx.user.update({
              where: { id: b.placedByUserId },
              data: { blueberryBalance: { increment: pay } },
            });
          }
        } else {
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

  // Зарплаты % от гринда за окно → личный B$ (идемпотентно).
  try {
    const { paySalariesForNightWindow } = await import("@/lib/factionHr");
    await paySalariesForNightWindow(bounds);
  } catch (e) {
    console.error("night salary payout failed", bounds.id, e);
  }

  return { settled: true };
}

/**
 * Досрочный итог тренировки (только Keech): сразу считает ставки по текущему гринду,
 * не дожидаясь 01:00 МСК.
 */
export async function forceCloseNightTraining(now = new Date()): Promise<{
  ok: true;
  windowId: string;
  alreadySettled?: boolean;
  raceFinalized?: boolean;
} | { ok: false; error: string }> {
  const bounds = nightBetWindowAt(now);
  if (now.getTime() < bounds.grindStart.getTime()) {
    return { ok: false, error: "grind_not_started" };
  }
  const result = await settleNightBetWindow(bounds, now, { force: true });
  const alreadySettled = !result.settled && result.reason === "already_settled";
  if (!result.settled && !alreadySettled) {
    return { ok: false, error: result.reason || "settle_failed" };
  }

  // Последняя TR недели гонки (пт→сб) — закрываем гонку вместе с тренировкой.
  let raceFinalized = false;
  try {
    const { finalizeRaceIfLastTrainingClosed } = await import(
      "@/lib/factionRaceEngine"
    );
    const race = await finalizeRaceIfLastTrainingClosed(bounds.id, now);
    raceFinalized = race.finalized;
  } catch (e) {
    console.error("race finalize on training close", e);
  }

  return {
    ok: true,
    windowId: bounds.id,
    alreadySettled: alreadySettled || undefined,
    raceFinalized: raceFinalized || undefined,
  };
}

export type NightBetPhase = "upcoming" | "open" | "locked" | "settled";

export type NightBetBoard = {
  label: string;
  windowId: string;
  betsOpenIso: string;
  betsCloseIso: string;
  grindStartIso: string;
  grindEndIso: string;
  status: NightBetPhase;
  canBet: boolean;
  /** Keech: кнопка «Закрыть тренировку» (досрочный итог ставок). */
  canCloseTraining: boolean;
  myFactionId: string | null;
  /** Казна фракции (для ставки главы/зама). */
  myTreasury: number;
  /** Личный B$ зрителя. */
  myPersonalBalance: number;
  /** Подпись баланса по умолчанию. */
  balanceLabel: string;
  /** Keech: баланс не ограничен. */
  infiniteBalance: boolean;
  isPersonalBettor: boolean;
  /** Можно ставить из казны (глава/зам). */
  canBetTreasury: boolean;
  /** Можно ставить с личного B$ (участник / Keech). */
  canBetPersonal: boolean;
  pot: number;
  minBet: number;
  /** Только фракции забега + ставка/кэф на каждую. */
  grind: {
    factionId: string;
    name: string;
    slug: string;
    color: string;
    font: string;
    amount: number;
    stakeOn: number;
    odds: number | null;
  }[];
  bets: {
    id: string;
    fromFactionId: string | null;
    fromName: string;
    fromColor: string;
    isPersonal: boolean;
    pickFactionId: string;
    pickName: string;
    pickColor: string;
    amount: number;
    odds: number | null;
    status: string;
    payout: number;
    placedByNick: string;
  }[];
  /** Все ставки этой стороны на разные исходы (отмена запрещена). */
  myBets: {
    pickFactionId: string;
    amount: number;
    odds: number | null;
    status: string;
    payout: number;
    isPersonal: boolean;
  }[];
  /** Совместимость: первая / избранная ставка. */
  myBet: {
    pickFactionId: string;
    amount: number;
    odds: number | null;
    status: string;
    payout: number;
    isPersonal: boolean;
  } | null;
  winners: {
    factionId: string;
    name: string;
    color: string;
    grindAmount: number;
  }[];
  /** Сколько каждая ставка-победитель забрала в казну. */
  payouts: {
    fromFactionId: string | null;
    fromName: string;
    fromColor: string;
    amount: number;
    payout: number;
  }[];
};

function phaseAt(
  bounds: NightBetWindowBounds,
  now: Date,
  settled: boolean
): NightBetPhase {
  if (settled || now.getTime() >= bounds.grindEnd.getTime()) return "settled";
  if (now.getTime() < bounds.betsOpen.getTime()) return "upcoming";
  if (now.getTime() < bounds.betsClose.getTime()) return "open";
  return "locked";
}

function personalBettorLabel(placedBy: {
  nick: string | null;
  steamName: string | null;
  name: string | null;
  steamId?: string | null;
}): { name: string; color: string } {
  if (placedBy.steamId && isBuiltinSuperAdmin(placedBy.steamId)) {
    return { name: KEECH_BET_NAME, color: KEECH_BET_COLOR };
  }
  const nick =
    (placedBy.nick && placedBy.nick.trim()) ||
    (placedBy.steamName && placedBy.steamName.trim()) ||
    (placedBy.name && placedBy.name.trim()) ||
    "Игрок";
  return { name: nick, color: "#a78bfa" };
}

export async function nightBetBoard(opts: {
  viewerFactionId: string | null;
  viewerUserId?: string | null;
  /** Участник этой фракции (может ставить личным B$). */
  isMember?: boolean;
  /** Глава/зам — казна фракции. */
  canPlaceTreasury?: boolean;
  canPlace: boolean;
  isKeech?: boolean;
  now?: Date;
}): Promise<NightBetBoard> {
  const now = opts.now || new Date();
  const bounds = nightBetWindowAt(now);
  await ensureWindow(bounds);

  if (now.getTime() >= bounds.grindEnd.getTime()) {
    await settleNightBetWindow(bounds, now).catch((e) =>
      console.error("night bet settle", e)
    );
  }

  const win = await prisma.factionNightBetWindow.findUnique({
    where: { id: bounds.id },
  });
  const grindFactions = await listGrindFactions();
  const bettors = await listBettorFactions();
  const grindIds = grindFactions.map((f) => f.id);
  const grindMap = await nightGrindSums(grindIds, bounds);

  const settled = win?.status === "settled";
  const phase = phaseAt(bounds, now, settled);
  const isKeech = Boolean(opts.isKeech);
  const isMember = Boolean(opts.isMember) || isKeech;
  const canPlaceTreasurySeat = Boolean(opts.canPlaceTreasury);

  const bets = await prisma.factionNightBet.findMany({
    where: { windowId: bounds.id },
    include: {
      fromFaction: { select: { id: true, name: true, slug: true, info: true } },
      pickFaction: { select: { id: true, name: true, slug: true, info: true } },
      placedBy: {
        select: { nick: true, name: true, steamName: true, steamId: true },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  const activeBets = bets.filter((b) =>
    settled
      ? true
      : b.status === "pending" ||
        b.status === "won" ||
        b.status === "lost" ||
        b.status === "refunded"
  );
  const potBets = settled ? bets : bets.filter((b) => b.status === "pending");
  const pot =
    settled && win ? win.pot : potBets.reduce((s, b) => s + b.amount, 0);
  const stakes = stakeByPick(potBets);

  const grind = grindFactions
    .map((f) => {
      const info = parseFactionInfo(f.info);
      const stakeOn = stakes.get(f.id) || 0;
      return {
        factionId: f.id,
        name: f.name,
        slug: f.slug,
        color: factionUiColor(f.name, f.slug),
        font: info.font || "Oxanium",
        amount: grindMap.get(f.id) || 0,
        stakeOn,
        odds: decimalOdds(pot, stakeOn),
      };
    })
    .sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name, "ru"));

  // Победитель гринда фиксируется только после 01:00 (settle), не по ходу каток.
  let winnerIds: string[] = [];
  if (settled) {
    winnerIds = win?.winnerFactionIds?.length
      ? win.winnerFactionIds
      : pickWinners(grindMap);
  }
  const winners = winnerIds
    .map((id) => {
      const f = grindFactions.find((x) => x.id === id);
      if (!f) return null;
      return {
        factionId: f.id,
        name: f.name,
        color: factionUiColor(f.name, f.slug),
        grindAmount: grindMap.get(f.id) || 0,
      };
    })
    .filter(Boolean) as NightBetBoard["winners"];

  const myFaction = opts.viewerFactionId
    ? bettors.find((f) => f.id === opts.viewerFactionId) || null
    : null;

  let myTreasury = 0;
  let myPersonalBalance = 0;
  let balanceLabel = "Казна фракции";
  let infiniteBalance = false;

  if (opts.viewerUserId) {
    const u = await prisma.user.findUnique({
      where: { id: opts.viewerUserId },
      select: { blueberryBalance: true },
    });
    myPersonalBalance = Math.max(0, u?.blueberryBalance || 0);
  }

  if (isKeech) {
    balanceLabel = "Личный B$ (безлимит)";
    infiniteBalance = true;
    myTreasury = 0;
  } else {
    myTreasury = Math.max(0, myFaction?.blueberryBalance || 0);
    if (opts.viewerFactionId && !myFaction) {
      const f = await prisma.faction.findUnique({
        where: { id: opts.viewerFactionId },
        select: { blueberryBalance: true },
      });
      myTreasury = Math.max(0, f?.blueberryBalance || 0);
    }
    balanceLabel = canPlaceTreasurySeat ? "Казна / личный B$" : "Личный B$";
  }

  const myBetRows = bets.filter((b) => {
    if (opts.viewerUserId && b.isPersonal && b.placedByUserId === opts.viewerUserId) {
      return true;
    }
    if (
      !isKeech &&
      opts.viewerFactionId &&
      !b.isPersonal &&
      b.fromFactionId === opts.viewerFactionId
    ) {
      return true;
    }
    return false;
  });

  const windowOpen = phase === "open" && !settled;
  const canBetPersonal =
    windowOpen &&
    Boolean(opts.viewerUserId) &&
    (isKeech || (isMember && Boolean(opts.viewerFactionId)));
  const canBetTreasury =
    windowOpen &&
    !isKeech &&
    canPlaceTreasurySeat &&
    Boolean(opts.viewerFactionId && myFaction);
  const canBet = canBetPersonal || canBetTreasury;

  // Только Кич, после старта гринда (21:00), пока окно не закрыто.
  const canCloseTraining =
    isKeech &&
    !settled &&
    now.getTime() >= bounds.grindStart.getTime();

  const betRows = activeBets.map((b) => {
    const odds = decimalOdds(pot, stakes.get(b.pickFactionId) || 0);
    const personal = b.isPersonal || !b.fromFaction;
    const person = personal
      ? personalBettorLabel(b.placedBy)
      : {
          name: b.fromFaction!.name,
          color: factionUiColor(b.fromFaction!.name, b.fromFaction!.slug),
        };
    return {
      id: b.id,
      fromFactionId: b.fromFactionId,
      fromName: personal ? `${person.name} · личный` : person.name,
      fromColor: person.color,
      isPersonal: personal,
      pickFactionId: b.pickFactionId,
      pickName: b.pickFaction.name,
      pickColor: factionUiColor(b.pickFaction.name, b.pickFaction.slug),
      amount: b.amount,
      odds,
      status: b.status,
      payout: b.payout,
      placedByNick:
        b.placedBy.nick || b.placedBy.steamName || b.placedBy.name || "—",
    };
  });

  const payouts = settled
    ? bets
        .filter((b) => b.payout > 0)
        .map((b) => {
          const personal = b.isPersonal || !b.fromFaction;
          const person = personal
            ? personalBettorLabel(b.placedBy)
            : {
                name: b.fromFaction!.name,
                color: factionUiColor(
                  b.fromFaction!.name,
                  b.fromFaction!.slug
                ),
              };
          return {
            fromFactionId: b.fromFactionId,
            fromName: personal ? `${person.name} · личный` : person.name,
            fromColor: person.color,
            amount: b.amount,
            payout: b.payout,
          };
        })
    : [];

  return {
    label: formatNightBetLabel(bounds),
    windowId: bounds.id,
    betsOpenIso: bounds.betsOpen.toISOString(),
    betsCloseIso: bounds.betsClose.toISOString(),
    grindStartIso: bounds.grindStart.toISOString(),
    grindEndIso: bounds.grindEnd.toISOString(),
    status: phase,
    canBet,
    canCloseTraining,
    myFactionId: opts.viewerFactionId,
    myTreasury,
    myPersonalBalance,
    balanceLabel,
    infiniteBalance,
    isPersonalBettor: isKeech || (!canBetTreasury && canBetPersonal),
    canBetTreasury,
    canBetPersonal,
    pot,
    minBet: NIGHT_BET_MIN,
    grind,
    bets: betRows,
    myBets: myBetRows.map((b) => ({
      pickFactionId: b.pickFactionId,
      amount: b.amount,
      odds: decimalOdds(pot, stakes.get(b.pickFactionId) || 0),
      status: b.status,
      payout: b.payout,
      isPersonal: Boolean(b.isPersonal),
    })),
    myBet: myBetRows[0]
      ? {
          pickFactionId: myBetRows[0].pickFactionId,
          amount: myBetRows[0].amount,
          odds: decimalOdds(pot, stakes.get(myBetRows[0].pickFactionId) || 0),
          status: myBetRows[0].status,
          payout: myBetRows[0].payout,
          isPersonal: Boolean(myBetRows[0].isPersonal),
        }
      : null,
    winners,
    payouts,
  };
}
/** История ставок фракции или личных ставок Keech. */
/** Общая книга ставок (все фракции + личные Keech), не только «свои». */
function shiftYmd(ymd: string, deltaDays: number): string | null {
  const p = parseYmd(ymd);
  if (!p) return null;
  const d = new Date(Date.UTC(p.y, p.m - 1, p.d));
  d.setUTCDate(d.getUTCDate() + deltaDays);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export type NightFactionGrindDayRow = {
  factionId: string;
  name: string;
  color: string;
  amount: number;
  /** Лидер по гринду за этот день / победитель окна. */
  isLeader: boolean;
  isWinner: boolean;
};

export type NightFactionGrindDay = {
  windowId: string;
  dayLabel: string;
  status: string;
  rows: NightFactionGrindDayRow[];
  /** Макс. гринд дня (для подсветки). */
  leaderAmount: number;
};

/** С этой даты (МСК training-day) показываем «Историю по дням» — раньше шум/тест. */
export const NIGHT_GRIND_DAYHIST_MIN_YMD = "2026-11-24";

/**
 * История по дням: сколько каждая фракция нагриндила за ночное окно (21:00–01:00).
 * Берём последние N training-day, даже если окно ставок ещё не создано.
 * Дни до NIGHT_GRIND_DAYHIST_MIN_YMD не отдаём.
 */
export async function nightFactionGrindDayHistory(opts?: {
  days?: number;
}): Promise<NightFactionGrindDay[]> {
  const n = Math.min(60, Math.max(1, opts?.days ?? 30));
  const factions = await listGrindFactions();
  if (!factions.length) return [];
  const factionIds = factions.map((f) => f.id);

  const startId = trainingDayYmd(new Date());
  const ymds: string[] = [];
  let cur: string | null = startId;
  for (let i = 0; i < n && cur; i += 1) {
    if (cur < NIGHT_GRIND_DAYHIST_MIN_YMD) break;
    ymds.push(cur);
    cur = shiftYmd(cur, -1);
  }

  const windows = await prisma.factionNightBetWindow.findMany({
    where: { id: { in: ymds } },
    select: { id: true, status: true, winnerFactionIds: true },
  });
  const winBy = new Map(windows.map((w) => [w.id, w]));

  const out: NightFactionGrindDay[] = [];
  for (const ymd of ymds) {
    const bounds = nightBetBoundsForDay(ymd);
    if (!bounds) continue;
    const sums = await nightGrindSums(factionIds, bounds);
    const win = winBy.get(ymd);
    const winners = new Set(win?.winnerFactionIds || []);
    let leaderAmount = 0;
    for (const id of factionIds) {
      leaderAmount = Math.max(leaderAmount, sums.get(id) || 0);
    }
    const rows: NightFactionGrindDayRow[] = factions
      .map((f) => {
        const info = parseFactionInfo(f.info);
        const amount = sums.get(f.id) || 0;
        return {
          factionId: f.id,
          name: f.name,
          color: factionUiColor(f.name, f.slug, info.color),
          amount,
          isLeader: leaderAmount > 0 && amount === leaderAmount,
          isWinner: winners.has(f.id),
        };
      })
      .sort(
        (a, b) =>
          b.amount - a.amount || a.name.localeCompare(b.name, "ru"),
      );
    out.push({
      windowId: ymd,
      dayLabel: formatNightBetDayLabel(bounds),
      status: win?.status || "open",
      rows,
      leaderAmount,
    });
  }
  return out;
}

type NightHistoryItem = {
  id: string;
  windowId: string;
  label: string;
  fromName: string;
  fromColor: string;
  pickName: string;
  pickColor: string;
  amount: number;
  status: string;
  payout: number;
  placedByNick: string;
  isPersonal: boolean;
};

function mapNightHistoryRow(r: {
  id: string;
  windowId: string;
  amount: number;
  status: string;
  payout: number;
  isPersonal: boolean;
  pickFaction: { name: string; slug: string; info: string | null };
  fromFaction: { name: string; slug: string; info: string | null } | null;
  placedBy: {
    nick: string | null;
    steamName: string | null;
    name: string | null;
    steamId: string | null;
  };
}): NightHistoryItem {
  const bounds = nightBetBoundsForDay(r.windowId);
  const fromInfo = r.fromFaction ? parseFactionInfo(r.fromFaction.info) : null;
  const pickInfo = parseFactionInfo(r.pickFaction.info);
  const placedByNick =
    (r.placedBy.nick && r.placedBy.nick.trim()) ||
    (r.placedBy.steamName && r.placedBy.steamName.trim()) ||
    (r.placedBy.name && r.placedBy.name.trim()) ||
    "—";
  let fromName: string;
  let fromColor: string;
  if (r.isPersonal) {
    const person = personalBettorLabel(r.placedBy);
    fromName = person.name;
    fromColor = person.color;
  } else if (r.fromFaction) {
    fromName = r.fromFaction.name;
    fromColor = factionUiColor(
      r.fromFaction.name,
      r.fromFaction.slug,
      fromInfo?.color
    );
  } else {
    fromName = "—";
    fromColor = "#94a3b8";
  }
  return {
    id: r.id,
    windowId: r.windowId,
    label: bounds ? formatNightBetDayLabel(bounds) : r.windowId,
    fromName,
    fromColor,
    pickName: r.pickFaction.name,
    pickColor: factionUiColor(
      r.pickFaction.name,
      r.pickFaction.slug,
      pickInfo.color
    ),
    amount: r.amount,
    status: r.status,
    payout: r.payout,
    placedByNick,
    isPersonal: r.isPersonal,
  };
}

export async function nightBetHistory(_opts?: {
  fromFactionId?: string | null;
  personalUserId?: string | null;
}): Promise<NightHistoryItem[]> {
  const rows = await prisma.factionNightBet.findMany({
    where: { status: { in: ["won", "lost", "refunded", "pending"] } },
    include: {
      pickFaction: { select: { name: true, slug: true, info: true } },
      fromFaction: { select: { name: true, slug: true, info: true } },
      placedBy: {
        select: { nick: true, steamName: true, name: true, steamId: true },
      },
      window: { select: { id: true, status: true } },
    },
    orderBy: [{ windowId: "desc" }, { createdAt: "desc" }],
    take: 400,
  });
  return rows.map(mapNightHistoryRow);
}

/** Только выигрыши: дата, кто, на кого, сколько забрал. */
export async function nightBetWinsHistory(): Promise<NightHistoryItem[]> {
  const rows = await prisma.factionNightBet.findMany({
    where: { status: "won", payout: { gt: 0 } },
    include: {
      pickFaction: { select: { name: true, slug: true, info: true } },
      fromFaction: { select: { name: true, slug: true, info: true } },
      placedBy: {
        select: { nick: true, steamName: true, name: true, steamId: true },
      },
      window: { select: { id: true, status: true } },
    },
    orderBy: [{ windowId: "desc" }, { createdAt: "desc" }],
    take: 400,
  });
  return rows.map(mapNightHistoryRow);
}

/**
 * Поставить / додеп.
 * source=treasury — глава/зам из казны.
 * source=personal — любой участник с личного B$ (Keech — безлимит).
 * Отмена запрещена; додеп до 21:30.
 */
export async function placeNightBet(opts: {
  actorUserId: string;
  actorSteamId: string | null;
  fromFactionId: string;
  pickFactionId: string;
  amount: number;
  source?: NightBetSource;
}): Promise<{ ok: true; mode: "place" | "topup" } | { ok: false; error: string }> {
  const amount = Math.trunc(Number(opts.amount) || 0);
  if (amount < NIGHT_BET_MIN) return { ok: false, error: "min_bet" };

  const keech = Boolean(
    opts.actorSteamId && isBuiltinSuperAdmin(opts.actorSteamId)
  );

  let seat: string | null = null;
  if (!keech) {
    const mem = await prisma.factionMember.findUnique({
      where: { userId: opts.actorUserId },
      select: { factionId: true, seat: true },
    });
    if (!mem || mem.factionId !== opts.fromFactionId) {
      return { ok: false, error: "not_member" };
    }
    seat = mem.seat;
  }

  const wantPersonal =
    keech ||
    opts.source === "personal" ||
    (opts.source !== "treasury" && seat === "MEMBER");
  const usePersonal = wantPersonal;
  if (!usePersonal) {
    if (seat !== "LEADER" && seat !== "DEPUTY" && !keech) {
      return { ok: false, error: "forbidden_seat" };
    }
  }

  const bounds = nightBetWindowAt();
  const now = new Date();
  if (now.getTime() < bounds.betsOpen.getTime()) {
    return { ok: false, error: "bets_not_open" };
  }
  if (now.getTime() >= bounds.betsClose.getTime()) {
    if (now.getTime() >= bounds.grindEnd.getTime()) {
      await settleNightBetWindow(bounds, now).catch(() => {});
    }
    return { ok: false, error: "window_closed" };
  }

  const grindFactions = await listGrindFactions();
  const pick = grindFactions.find((f) => f.id === opts.pickFactionId);
  if (!pick) return { ok: false, error: "bad_pick" };

  if (!keech) {
    const bettors = await listBettorFactions();
    const from = bettors.find((f) => f.id === opts.fromFactionId);
    if (!from) return { ok: false, error: "bad_faction" };
  }

  await ensureWindow(bounds);
  const win = await prisma.factionNightBetWindow.findUnique({
    where: { id: bounds.id },
  });
  if (!win || win.status === "settled") return { ok: false, error: "window_closed" };

  const existing = usePersonal
    ? await prisma.factionNightBet.findFirst({
        where: {
          windowId: bounds.id,
          isPersonal: true,
          placedByUserId: opts.actorUserId,
          pickFactionId: opts.pickFactionId,
          status: "pending",
        },
      })
    : await prisma.factionNightBet.findFirst({
        where: {
          windowId: bounds.id,
          fromFactionId: opts.fromFactionId,
          pickFactionId: opts.pickFactionId,
          isPersonal: false,
          status: "pending",
        },
      });

  const mode: "place" | "topup" = existing ? "topup" : "place";

  try {
    await prisma.$transaction(async (tx) => {
      if (keech) {
        // Безлимит: только учёт ставки в пуле, без списания кошелька.
        if (mode === "topup" && existing) {
          await tx.factionNightBet.update({
            where: { id: existing.id },
            data: { amount: existing.amount + amount },
          });
        } else {
          await tx.factionNightBet.create({
            data: {
              windowId: bounds.id,
              fromFactionId: null,
              pickFactionId: opts.pickFactionId,
              amount,
              placedByUserId: opts.actorUserId,
              isPersonal: true,
              status: "pending",
            },
          });
        }
      } else if (usePersonal) {
        const u = await tx.user.findUnique({
          where: { id: opts.actorUserId },
          select: { blueberryBalance: true },
        });
        if (!u) throw new Error("user");
        const bal = Math.max(0, u.blueberryBalance || 0);
        if (bal < amount) throw new Error("insufficient_personal");

        if (mode === "topup" && existing) {
          await tx.factionNightBet.update({
            where: { id: existing.id },
            data: { amount: existing.amount + amount },
          });
        } else {
          await tx.factionNightBet.create({
            data: {
              windowId: bounds.id,
              fromFactionId: null,
              pickFactionId: opts.pickFactionId,
              amount,
              placedByUserId: opts.actorUserId,
              isPersonal: true,
              status: "pending",
            },
          });
        }
        await tx.user.update({
          where: { id: opts.actorUserId },
          data: { blueberryBalance: bal - amount },
        });
      } else {
        const f = await tx.faction.findUnique({
          where: { id: opts.fromFactionId },
          select: { blueberryBalance: true },
        });
        if (!f) throw new Error("faction");
        const treasury = Math.max(0, f.blueberryBalance || 0);
        if (treasury < amount) throw new Error("insufficient");

        if (mode === "topup" && existing) {
          await tx.factionNightBet.update({
            where: { id: existing.id },
            data: { amount: existing.amount + amount },
          });
          await tx.factionLedgerEntry.create({
            data: {
              factionId: opts.fromFactionId,
              amount: -amount,
              kind: "night_bet",
              sourceKey: `night_bet_topup:${bounds.id}:${existing.id}:${Date.now()}`,
              note: `Додеп ${amount.toLocaleString("ru-RU")} ${BD_MARK} на «${pick.name}» (ночь ${bounds.id})`,
              userId: opts.actorUserId,
            },
          });
        } else {
          const bet = await tx.factionNightBet.create({
            data: {
              windowId: bounds.id,
              fromFactionId: opts.fromFactionId,
              pickFactionId: opts.pickFactionId,
              amount,
              placedByUserId: opts.actorUserId,
              isPersonal: false,
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
        }
        await tx.faction.update({
          where: { id: opts.fromFactionId },
          data: { blueberryBalance: treasury - amount },
        });
      }

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
    if (msg === "insufficient_personal") {
      return { ok: false, error: "insufficient_personal" };
    }
    console.error("placeNightBet", e);
    return { ok: false, error: "debit" };
  }

  return { ok: true, mode };
}