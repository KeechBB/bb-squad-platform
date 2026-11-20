import { prisma } from "@/lib/prisma";
import { personLabel, writeActionLog } from "@/lib/actionLog";
import { logFaction } from "@/lib/factions";
import { isActiveReserve } from "@/lib/validation";
import {
  RACE_BASE_GOAL,
  RACE_FACTION_NAMES,
  RACE_GRACE_MS,
  formatRaceWindowLabel,
  mskWeekday,
  nextRaceGoal,
  raceWindowAt,
  raceWindowByIndex,
  type RaceWindowBounds,
} from "@/lib/factionRaceCanon";
import {
  day1Body,
  exemptBody,
  finalFailBody,
  finalMetBody,
  lostComradeBody,
  midBody,
  sendRaceMail,
  victimKickBody,
} from "@/lib/factionRaceMail";

async function bbClanId(): Promise<string | null> {
  const bb = await prisma.clan.findFirst({
    where: { tag: "BB", isExternal: false },
    select: { id: true },
  });
  return bb?.id || null;
}

export async function listRacingFactions() {
  const clanId = await bbClanId();
  if (!clanId) return [];
  return prisma.faction.findMany({
    where: { clanId, name: { in: [...RACE_FACTION_NAMES] } },
    select: { id: true, name: true, slug: true, clanId: true },
    orderBy: { name: "asc" },
  });
}

async function ensureRaceStates(factionIds: string[]) {
  for (const id of factionIds) {
    await prisma.factionRaceState.upsert({
      where: { factionId: id },
      create: { factionId: id, goal: RACE_BASE_GOAL },
      update: {},
    });
  }
}

async function grindSum(factionId: string, start: Date, end: Date): Promise<number> {
  const agg = await prisma.factionLedgerEntry.aggregate({
    where: {
      factionId,
      kind: "grind",
      amount: { gt: 0 },
      createdAt: { gte: start, lt: end },
    },
    _sum: { amount: true },
  });
  return Math.max(0, agg._sum.amount || 0);
}

async function memberUserIds(factionId: string): Promise<string[]> {
  const rows = await prisma.factionMember.findMany({
    where: { factionId },
    select: { userId: true },
  });
  return rows.map((r) => r.userId);
}

/** Кто уже был в резерве на момент закрытия окна (enteredAt < end). */
async function snapshotProtectedReserveIds(factionId: string, end: Date): Promise<string[]> {
  const members = await prisma.factionMember.findMany({
    where: { factionId },
    select: {
      userId: true,
      user: { select: { reserveUntil: true } },
    },
  });
  const ids = members.map((m) => m.userId);
  if (!ids.length) return [];

  const stints = await prisma.reserveStint.findMany({
    where: {
      userId: { in: ids },
      enteredAt: { lt: end },
      OR: [{ exitedAt: null }, { exitedAt: { gte: end } }],
    },
    select: { userId: true },
  });
  const fromStint = new Set(stints.map((s) => s.userId));

  // Фоллбек: активный reserveUntil, если нет stint (старые записи)
  for (const m of members) {
    if (isActiveReserve(m.user.reserveUntil) && !fromStint.has(m.userId)) {
      // Без stint не знаем enteredAt — считаем честным только если reserveUntil был до end
      // (приближение). Предпочитаем stint.
      fromStint.add(m.userId);
    }
  }
  return [...fromStint];
}

async function ensureWindow(bounds: RaceWindowBounds) {
  const factions = await listRacingFactions();
  if (!factions.length) return { window: null as null, factions };
  await ensureRaceStates(factions.map((f) => f.id));

  await prisma.factionRaceWindow.upsert({
    where: { id: bounds.id },
    create: { id: bounds.id, startAt: bounds.start, endAt: bounds.end },
    update: { startAt: bounds.start, endAt: bounds.end },
  });

  const states = await prisma.factionRaceState.findMany({
    where: { factionId: { in: factions.map((f) => f.id) } },
  });
  const goalBy = new Map(states.map((s) => [s.factionId, s.goal]));

  for (const f of factions) {
    await prisma.factionRaceResult.upsert({
      where: { windowId_factionId: { windowId: bounds.id, factionId: f.id } },
      create: {
        windowId: bounds.id,
        factionId: f.id,
        goal: goalBy.get(f.id) || RACE_BASE_GOAL,
        status: "open",
      },
      update: {},
    });
  }

  return { window: bounds, factions };
}

async function sendDay1IfNeeded(bounds: RaceWindowBounds, now: Date) {
  if (now < bounds.start) return;
  const results = await prisma.factionRaceResult.findMany({
    where: { windowId: bounds.id, day1MailAt: null },
    include: { faction: { select: { id: true, name: true } } },
  });
  const label = formatRaceWindowLabel(bounds.start, bounds.end);
  for (const r of results) {
    const ids = await memberUserIds(r.factionId);
    await sendRaceMail({
      toUserIds: ids,
      title: `Гонка фракций · план ${r.goal.toLocaleString("ru-RU")} B$`,
      body: day1Body(r.faction.name, r.goal, label),
      sourceKey: `race:day1:${bounds.id}:${r.factionId}`,
      hidden: true,
    });
    await prisma.factionRaceResult.update({
      where: { id: r.id },
      data: { day1MailAt: now },
    });
  }
}

async function sendMidIfNeeded(bounds: RaceWindowBounds, now: Date) {
  // Вторник МСК, после старта окна и до конца
  if (now < bounds.start || now >= bounds.end) return;
  if (mskWeekday(now) !== 2) return;

  const results = await prisma.factionRaceResult.findMany({
    where: { windowId: bounds.id, midMailAt: null, status: "open" },
    include: { faction: { select: { name: true } } },
  });
  const leftMs = bounds.end.getTime() - now.getTime();
  const leftH = Math.max(1, Math.round(leftMs / 3_600_000));
  const leftLabel = leftH >= 48 ? `${Math.round(leftH / 24)} дн.` : `${leftH} ч.`;

  for (const r of results) {
    const amount = await grindSum(r.factionId, bounds.start, bounds.end);
    const pct = r.goal > 0 ? Math.round((amount / r.goal) * 100) : 0;
    // «В прогнозе» ≈ линейный темп: доля времени окна
    const elapsed = Math.max(0, now.getTime() - bounds.start.getTime());
    const span = bounds.end.getTime() - bounds.start.getTime();
    const expectedPct = span > 0 ? (elapsed / span) * 100 : 100;
    const onPace = pct + 5 >= expectedPct; // небольшой запас
    const ids = await memberUserIds(r.factionId);
    await sendRaceMail({
      toUserIds: ids,
      title: onPace
        ? `Гонка · «${r.faction.name}» держит темп`
        : `Гонка · «${r.faction.name}» отстаёт`,
      body: midBody({
        factionName: r.faction.name,
        onPace,
        pct,
        leftLabel,
        salt: bounds.index * 31 + r.factionId.length + pct,
      }),
      sourceKey: `race:mid:${bounds.id}:${r.factionId}`,
      hidden: true,
    });
    await prisma.factionRaceResult.update({
      where: { id: r.id },
      data: { midMailAt: now },
    });
  }
}

async function finalizeWindow(bounds: RaceWindowBounds, now: Date) {
  if (now < bounds.end) return;

  const results = await prisma.factionRaceResult.findMany({
    where: { windowId: bounds.id, status: "open" },
    include: { faction: { select: { id: true, name: true, clanId: true } } },
  });
  if (!results.length) return;

  for (const r of results) {
    const amount = await grindSum(r.factionId, bounds.start, bounds.end);
    const met = amount >= r.goal;
    const nextGoal = nextRaceGoal(r.goal, met);
    const protectedReserveIds = met
      ? []
      : await snapshotProtectedReserveIds(r.factionId, bounds.end);

    await prisma.factionRaceState.upsert({
      where: { factionId: r.factionId },
      create: { factionId: r.factionId, goal: nextGoal },
      update: { goal: nextGoal },
    });

    if (met) {
      await prisma.factionRaceResult.update({
        where: { id: r.id },
        data: {
          amount,
          met: true,
          status: "finalized",
          finalMailAt: now,
        },
      });
      const ids = await memberUserIds(r.factionId);
      await sendRaceMail({
        toUserIds: ids,
        title: `План выполнен · «${r.faction.name}»`,
        body: finalMetBody(r.faction.name, amount, r.goal, nextGoal),
        sourceKey: `race:final:${bounds.id}:${r.factionId}`,
      });
    } else {
      const graceEndsAt = new Date(bounds.end.getTime() + RACE_GRACE_MS);
      await prisma.factionRaceResult.update({
        where: { id: r.id },
        data: {
          amount,
          met: false,
          status: "grace",
          graceEndsAt,
          protectedReserveIds,
          finalMailAt: now,
        },
      });
      const ids = await memberUserIds(r.factionId);
      await sendRaceMail({
        toUserIds: ids,
        title: `План не выполнен · 24 часа на трансфер`,
        body: finalFailBody(r.faction.name, amount, r.goal, nextGoal),
        sourceKey: `race:final:${bounds.id}:${r.factionId}`,
      });
      await writeActionLog({
        category: "faction",
        action: "faction_race_fail",
        message: `Гонка: «${r.faction.name}» не набрала ${r.goal} (факт ${amount}). Grace до ${graceEndsAt.toISOString()}.`,
        clanId: r.faction.clanId,
        clanTag: "BB",
        meta: {
          windowId: bounds.id,
          factionId: r.factionId,
          goal: r.goal,
          amount,
          graceEndsAt: graceEndsAt.toISOString(),
        },
      });
    }
  }

  // Следующее окно сразу
  const next = raceWindowByIndex(bounds.index + 1);
  await ensureWindow(next);
}

function pickRandom<T>(arr: T[]): T | null {
  if (!arr.length) return null;
  return arr[Math.floor(Math.random() * arr.length)]!;
}

async function eligibleForceCandidates(
  factionId: string,
  protectedReserveIds: string[],
): Promise<{ userId: string; nick: string }[]> {
  const protectedSet = new Set(protectedReserveIds);
  const members = await prisma.factionMember.findMany({
    where: { factionId, seat: "MEMBER" },
    select: {
      userId: true,
      user: { select: { id: true, nick: true, name: true, steamName: true, reserveUntil: true } },
    },
  });
  const out: { userId: string; nick: string }[] = [];
  for (const m of members) {
    if (protectedSet.has(m.userId)) continue;
    // Резерв после дедлайна — не защищает (уже не в protectedSet)
    out.push({ userId: m.userId, nick: personLabel(m.user) });
  }
  return out;
}

async function addSriBanAndMaybeReset(userId: string, factionId: string) {
  await prisma.factionRaceSriBan.upsert({
    where: { userId_factionId: { userId, factionId } },
    create: { userId, factionId },
    update: {},
  });
  const racing = await listRacingFactions();
  const bans = await prisma.factionRaceSriBan.findMany({
    where: { userId, factionId: { in: racing.map((f) => f.id) } },
    select: { factionId: true },
  });
  if (bans.length >= racing.length && racing.length > 0) {
    await prisma.factionRaceSriBan.deleteMany({
      where: { userId, factionId: { in: racing.map((f) => f.id) } },
    });
    await writeActionLog({
      category: "faction",
      action: "faction_race_sri_ban_reset",
      message: `Гонка: сброс СРИ-банов игрока — выкинут системой из всех пехотных фракций.`,
      targetId: userId,
      meta: { userId },
    });
  }
}

async function executeForce(resultId: string, now: Date) {
  const r = await prisma.factionRaceResult.findUnique({
    where: { id: resultId },
    include: {
      faction: { select: { id: true, name: true, clanId: true } },
      window: true,
    },
  });
  if (!r || r.status !== "grace") return;
  if (!r.graceEndsAt || now < r.graceEndsAt) return;

  const candidates = await eligibleForceCandidates(r.factionId, r.protectedReserveIds);
  const victim = pickRandom(candidates);
  if (!victim) {
    await prisma.factionRaceResult.update({
      where: { id: r.id },
      data: { status: "forced", forcedAt: now },
    });
    await writeActionLog({
      category: "faction",
      action: "faction_race_force_skip",
      message: `Гонка: «${r.faction.name}» — нет кандидатов на автоштраф (пул пуст).`,
      clanId: r.faction.clanId,
      clanTag: "BB",
      meta: { windowId: r.windowId, factionId: r.factionId },
    });
    return;
  }

  const keech = await prisma.user.findFirst({
    where: { steamId: "76561198028435874" },
    select: { id: true },
  });

  await prisma.factionMember.deleteMany({
    where: { factionId: r.factionId, userId: victim.userId },
  });
  await prisma.factionInvite.updateMany({
    where: { userId: victim.userId, status: { in: ["PENDING", "ACCEPTED"] } },
    data: { status: "CANCELLED" },
  });
  await prisma.transferListing.updateMany({
    where: { playerUserId: victim.userId, status: "ACTIVE" },
    data: { status: "WITHDRAWN" },
  });

  await logFaction("kick", {
    actorId: keech?.id || null,
    actorNick: "Гонка фракций",
    targetId: victim.userId,
    targetNick: victim.nick,
    factionName: r.faction.name,
    clanId: r.faction.clanId,
    how: "автоштраф гонки",
    reason:
      "фракция не выполнила недельный план гринда и не сделала самостоятельный трансфер за 24 часа",
  });

  await addSriBanAndMaybeReset(victim.userId, r.factionId);

  await prisma.factionRaceResult.update({
    where: { id: r.id },
    data: {
      status: "forced",
      forcedUserId: victim.userId,
      forcedAt: now,
    },
  });

  const rosterIds = await memberUserIds(r.factionId);
  await sendRaceMail({
    toUserIds: [...rosterIds, victim.userId],
    title: `Потеря товарища · «${r.faction.name}»`,
    body: lostComradeBody(r.faction.name, victim.nick),
    sourceKey: `race:lost:${r.windowId}:${r.factionId}`,
  });
  await sendRaceMail({
    toUserIds: [victim.userId],
    title: `Исключение · гонка фракций`,
    body: victimKickBody(r.faction.name),
    sourceKey: `race:victim:${r.windowId}:${r.factionId}:${victim.userId}`,
  });

  // СРИ: свободный агент → другая фракция с учётом банов
  try {
    const { assignFreeAgent } = await import("@/lib/sri");
    await assignFreeAgent({
      userId: victim.userId,
      reason: "race_force",
      excludeFactionIds: [r.factionId],
    });
  } catch (e) {
    console.error("race force SRI failed", e);
  }

  await writeActionLog({
    category: "faction",
    action: "faction_race_forced",
    message: `Гонка: автоштраф «${r.faction.name}» — ${victim.nick} → свободный агент / СРИ.`,
    actorNick: "Гонка фракций",
    targetId: victim.userId,
    targetNick: victim.nick,
    clanId: r.faction.clanId,
    clanTag: "BB",
    meta: { windowId: r.windowId, factionId: r.factionId },
  });
}

async function processExpiredGraces(now: Date) {
  const due = await prisma.factionRaceResult.findMany({
    where: {
      status: "grace",
      graceEndsAt: { lte: now },
    },
    select: { id: true },
  });
  for (const row of due) {
    await executeForce(row.id, now);
  }
}

/**
 * Успешный исходящий трансфер во время grace → exempt.
 * Вызывать после acceptTransferOffer для каждой фракции, из которой ушёл человек.
 */
export async function tryExemptRaceGrace(opts: {
  factionId: string;
  playerUserId: string;
  playerNick?: string;
}): Promise<boolean> {
  const now = new Date();
  const row = await prisma.factionRaceResult.findFirst({
    where: {
      factionId: opts.factionId,
      status: "grace",
      graceEndsAt: { gt: now },
    },
    include: { faction: { select: { name: true, clanId: true } } },
  });
  if (!row) return false;

  // Честный резерв нельзя «слить» как спасение? Канон: любой успешный уход спасает.
  // Но защищённых резервистов на доску лучше не пускать отдельно.
  await prisma.factionRaceResult.update({
    where: { id: row.id },
    data: { status: "exempt", exemptAt: now },
  });

  let nick = opts.playerNick || "";
  if (!nick) {
    const u = await prisma.user.findUnique({
      where: { id: opts.playerUserId },
      select: { nick: true, name: true, steamName: true },
    });
    nick = u ? personLabel(u) : "игрок";
  }

  const ids = await memberUserIds(opts.factionId);
  await sendRaceMail({
    toUserIds: ids,
    title: `Спасение трансфером · «${row.faction.name}»`,
    body: exemptBody(row.faction.name, nick),
    sourceKey: `race:exempt:${row.windowId}:${row.factionId}`,
  });

  await writeActionLog({
    category: "faction",
    action: "faction_race_exempt",
    message: `Гонка: «${row.faction.name}» спасена трансфером (${nick}).`,
    targetId: opts.playerUserId,
    targetNick: nick,
    clanId: row.faction.clanId,
    clanTag: "BB",
    meta: { windowId: row.windowId, factionId: opts.factionId },
  });
  return true;
}

export async function getFactionRaceGrace(factionId: string): Promise<{
  endsAt: string;
  endsAtMs: number;
  remainingMs: number;
  windowId: string;
} | null> {
  const now = Date.now();
  const row = await prisma.factionRaceResult.findFirst({
    where: {
      factionId,
      status: "grace",
      graceEndsAt: { gt: new Date(now) },
    },
    select: { graceEndsAt: true, windowId: true },
  });
  if (!row?.graceEndsAt) return null;
  const endsAtMs = row.graceEndsAt.getTime();
  return {
    endsAt: row.graceEndsAt.toISOString(),
    endsAtMs,
    remainingMs: Math.max(0, endsAtMs - now),
    windowId: row.windowId,
  };
}

export async function isProtectedRaceReserve(
  factionId: string,
  userId: string,
): Promise<boolean> {
  const row = await prisma.factionRaceResult.findFirst({
    where: { factionId, status: "grace" },
    select: { protectedReserveIds: true },
  });
  if (!row) return false;
  return row.protectedReserveIds.includes(userId);
}

/** Главный тик: окна, письма, финалы, grace→force. */
export async function tickFactionRace(now = new Date()): Promise<{
  ok: true;
  windowId: string | null;
  actions: string[];
}> {
  const actions: string[] = [];
  const current = raceWindowAt(now);

  // До эпохи — только ждём
  if (!current) {
    // Финализируем ничего; но если вдруг epoch уже близко — ok
    return { ok: true, windowId: null, actions: ["before_epoch"] };
  }

  // Закрыть предыдущее, если ещё open (на случай пропуска тика)
  if (current.index > 0) {
    const prev = raceWindowByIndex(current.index - 1);
    await ensureWindow(prev);
    await finalizeWindow(prev, now);
    actions.push(`finalize:${prev.id}`);
  }

  await ensureWindow(current);
  actions.push(`ensure:${current.id}`);

  await sendDay1IfNeeded(current, now);
  await sendMidIfNeeded(current, now);

  // Если уже за концом текущего (тик ровно на стыке) — finalize current
  if (now >= current.end) {
    await finalizeWindow(current, now);
    actions.push(`finalize_current:${current.id}`);
    const next = raceWindowByIndex(current.index + 1);
    await ensureWindow(next);
    await sendDay1IfNeeded(next, now);
  }

  await processExpiredGraces(now);
  actions.push("graces");

  return { ok: true, windowId: current.id, actions };
}
