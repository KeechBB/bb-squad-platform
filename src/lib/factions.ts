import { prisma } from "@/lib/prisma";
import { isBuiltinSuperAdmin } from "@/lib/admin";
import { personLabel, writeActionLog } from "@/lib/actionLog";
import { trainingKitHoursByUserIds } from "@/lib/squadRoles";
import { canonKitName } from "@/lib/squadKits";
import { TRAINING_SERVER_KEYS } from "@/lib/squadServers";
import {
  estimateWithKit,
  loadPlayerPriceStats,
  normalizeKit,
} from "@/lib/factionTransfers";
import { loadPlayerValueBonuses } from "@/lib/playerValueBonus";
import { resolveFactionAngel } from "@/lib/nickCollisions";
import type { ScarcityForPrice } from "@/lib/blueberryDollar";
import type { FactionSeat } from "@prisma/client";

export const DEPUTY_ROLE_NAME = "Зам. Фракции";

const SLUG_MAX = 40;

export function isBlackberryClan(clan: { tag: string; isExternal: boolean }): boolean {
  return !clan.isExternal && clan.tag.trim().toUpperCase() === "BB";
}

/** Адрес страницы = название: пробелы в дефис, остальное как написали. */
export function factionSlug(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9\u0400-\u04ff-]/gi, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, SLUG_MAX);
  return slug;
}

export function factionPath(slug: string): string {
  return `/factions/${encodeURIComponent(slug)}`;
}

/** Страница фракции игрока. Пусто, если он ни в одной. */
export async function factionSlugForSteam(
  steamId: string | null | undefined
): Promise<string | null> {
  if (!steamId || isBuiltinSuperAdmin(steamId)) return null;
  const user = await prisma.user.findUnique({
    where: { steamId },
    select: {
      factionMembership: { select: { faction: { select: { slug: true } } } },
    },
  });
  return user?.factionMembership?.faction.slug ?? null;
}

export function roleLabel(seat: FactionSeat, roleName: string | null): string {
  if (seat === "LEADER") return "Глава";
  if (seat === "DEPUTY") return DEPUTY_ROLE_NAME;
  return roleName || "—";
}

type MemberUser = {
  id: string;
  nick: string | null;
  name: string | null;
  steamName: string | null;
  steamId: string | null;
  avatarUrl: string | null;
};

export type FactionMemberRow = {
  id: string;
  userId: string;
  nick: string;
  name: string;
  seat: FactionSeat;
  roleId: string | null;
  roleName: string;
  joinedAt: string;
  order: number;
  mainKit: string;
  /** Рыночная оценка без гриндового бонуса. */
  marketValue: number;
  /** Сколько B$ игрок капнул в казны гринда. */
  grindBroughtBd: number;
  /** Победы КВ Main / Junior × тариф + разовый Main-состав. */
  cwValueBonus: number;
  mainCwWins: number;
  juniorCwWins: number;
  foundingBonus: number;
  /** 20 000 + grindBroughtBd (CW-бонус в цену не входит). */
  playerValue: number;
};

/** Как в трансферной scarcity — без второго прохода mainKits. */
function rosterKitScarcity(count: number, rosterSize: number): ScarcityForPrice {
  if (rosterSize < 8) return count <= 1 ? "critical" : "ok";
  const share = count / Math.max(1, rosterSize);
  if (count <= 1 || share < 0.04) return "critical";
  if (count <= 2 || share < 0.08) return "thin";
  if (share > 0.28) return "surplus";
  return "ok";
}

export type FactionView = {
  id: string;
  clanId: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  tgUrl: string | null;
  info: string;
  /** Казна Черничных Долларов */
  blueberryBalance: number;
  leaderNick: string | null;
  deputyNicks: string[];
  roles: { id: string; name: string; isDeputy: boolean }[];
  members: FactionMemberRow[];
  canEditIdentity: boolean;
  canManage: boolean;
  canEditInfo: boolean;
  mySeat: FactionSeat | null;
  myUserId: string | null;
  keech: boolean;
  invitePool: {
    id: string;
    nick: string;
    name: string;
    steamId: string;
    steamName: string;
    /** Уже состоит в другой фракции — в поиске виден, но пригласить нельзя. */
    blockedIn?: string | null;
  }[];
  leaderPool: {
    id: string;
    nick: string;
    name: string;
    steamId: string;
    steamName: string;
  }[];
};

function visibleNick(u: MemberUser): string {
  // Ник в Steam — маска для чтения. Кто это, решает steamId аккаунта.
  return u.steamName || u.nick || "—";
}

/** Основной кит = max часов только в залитых TR-матчах сайта за 14 суток МСК. */
export async function mainKits(userIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!userIds.length) return out;
  const uniq = [...new Set(userIds.filter(Boolean))];
  const hours = await trainingKitHoursByUserIds(uniq);
  for (const [userId, row] of hours) {
    if (row.mainKit) out.set(userId, row.mainKit);
  }

  // Нет спавнов в окне 14д → последний известный кит на TR (иначе в «Развитии» роль «—»).
  const missing = uniq.filter((id) => !out.has(id));
  if (missing.length) {
    const users = await prisma.user.findMany({
      where: { id: { in: missing } },
      select: { id: true, steamId: true },
    });
    for (const u of users) {
      const last = await prisma.squadRoleEvent.findFirst({
        where: {
          OR: [
            { userId: u.id },
            ...(u.steamId ? [{ steamId: u.steamId }] : []),
          ],
          serverKey: { in: [...TRAINING_SERVER_KEYS] },
          kit: { not: "" },
        },
        orderBy: { spawnedAt: "desc" },
        select: { kit: true },
      });
      const kit = canonKitName(String(last?.kit || "").trim());
      if (kit) out.set(u.id, kit);
    }
  }
  return out;
}

export async function requireKeech(steamId: string | null | undefined) {
  if (!steamId || !isBuiltinSuperAdmin(steamId)) return null;
  return prisma.user.findUnique({ where: { steamId } });
}

export async function loadFactionView(slug: string, steamId: string | null) {
  const faction = await prisma.faction.findUnique({
    where: { slug },
    include: {
      clan: { select: { id: true, tag: true, isExternal: true } },
      roles: { orderBy: [{ sortOrder: "asc" }, { name: "asc" }] },
      members: {
        orderBy: { joinedAt: "asc" },
        include: {
          role: { select: { id: true, name: true, isDeputy: true } },
          user: {
            select: {
              id: true,
              nick: true,
              name: true,
              steamName: true,
              steamId: true,
              avatarUrl: true,
            },
          },
        },
      },
    },
  });
  if (!faction || !isBlackberryClan(faction.clan)) return { error: "notfound" as const };

  const keech = Boolean(steamId && isBuiltinSuperAdmin(steamId));
  const me = steamId
    ? await prisma.user.findUnique({
        where: { steamId },
        select: { id: true, nick: true, name: true, steamName: true, steamId: true },
      })
    : null;
  const mine = me
    ? faction.members.find((m) => m.userId === me.id && !isBuiltinSuperAdmin(m.user.steamId))
    : undefined;
  const mySeat: FactionSeat | null = keech ? null : mine?.seat ?? null;
  const bbClanMember = me
    ? await prisma.clanMember.findFirst({
        where: { userId: me.id, clanId: faction.clanId },
        select: { id: true },
      })
    : null;
  /** Keech, участник этой фракции или любой член BB — можно открыть страницу (управление только у состава/штаба). */
  const canView = keech || Boolean(mine) || Boolean(bbClanMember);
  if (!canView) return { error: "notfound" as const };

  const staff = keech || mySeat === "LEADER" || mySeat === "DEPUTY";
  const listed = faction.members.filter((m) => !isBuiltinSuperAdmin(m.user.steamId));
  const userIds = listed.map((m) => m.userId);
  const bonusMembers = listed.map((m) => {
    const nick = m.user.nick || m.user.steamName || visibleNick(m.user);
    // Во фракциях angel = Саня BB (не Алан / не омонимы).
    const fa = resolveFactionAngel({
      nick,
      steamName: m.user.steamName,
      steamId: m.user.steamId,
    });
    return {
      userId: m.userId,
      nick: fa?.siteNick || nick,
      steamName: m.user.steamName,
      steamId: fa?.steamId || m.user.steamId,
    };
  });
  const [kits, priceStats, valueBonuses] = await Promise.all([
    mainKits(userIds),
    loadPlayerPriceStats(userIds),
    loadPlayerValueBonuses(bonusMembers),
  ]);

  const kitCounts = new Map<string, number>();
  for (const uid of userIds) {
    const k = normalizeKit(kits.get(uid) || null);
    kitCounts.set(k, (kitCounts.get(k) || 0) + 1);
  }
  const rosterSize = userIds.length;

  const members: FactionMemberRow[] = listed.map((m, i) => {
    const mainKit = kits.get(m.userId) || "—";
    const kitKey = normalizeKit(mainKit);
    const st = priceStats.get(m.userId);
    const grindBroughtBd = Math.max(0, Math.round(st?.grindBroughtBd || 0));
    const scarcity = rosterKitScarcity(kitCounts.get(kitKey) || 0, rosterSize);
    // База без гринда (для разбивки в UI); полная цена = 20k + гринд.
    const marketValue = estimateWithKit(
      st ? { ...st, grindBroughtBd: 0 } : undefined,
      mainKit,
      scarcity,
    );
    const playerValue = estimateWithKit(
      st || {
        trainDays14: 0,
        matches30: 0,
        kills30: 0,
        deaths30: 0,
        res30: 0,
        nok30: 0,
        lastSeenDaysAgo: null,
        grindBroughtBd,
      },
      mainKit,
      scarcity,
    );
    const bonus = valueBonuses.get(m.userId);
    const cwValueBonus = bonus?.total || 0;
    return {
      id: m.id,
      userId: m.userId,
      nick: visibleNick(m.user),
      name: m.user.name || "—",
      seat: m.seat,
      roleId: m.roleId,
      roleName: roleLabel(m.seat, m.role?.name ?? null),
      joinedAt: m.joinedAt.toISOString(),
      order: i + 1,
      mainKit,
      marketValue,
      grindBroughtBd,
      cwValueBonus,
      mainCwWins: bonus?.mainWins || 0,
      juniorCwWins: bonus?.juniorWins || 0,
      foundingBonus: bonus?.foundingBonus || 0,
      /** Канон: 20 000 + гринд. CW-бонус в цену больше не входит. */
      playerValue,
    };
  });

  const leader = members.find((m) => m.seat === "LEADER") || null;
  const deputies = members.filter((m) => m.seat === "DEPUTY").map((m) => m.nick);

  let invitePool: FactionView["invitePool"] = [];
  let leaderPool: FactionView["leaderPool"] = [];
  if (staff || keech) {
    const clanMembers = await prisma.clanMember.findMany({
      where: { clanId: faction.clanId },
      include: {
        user: { select: { id: true, nick: true, name: true, steamId: true, steamName: true } },
      },
      orderBy: { user: { nick: "asc" } },
    });
    const [taken, factionNames] = await Promise.all([
      prisma.factionMember.findMany({
        select: {
          userId: true,
          factionId: true,
          faction: { select: { name: true } },
        },
      }),
      prisma.faction.findMany({
        where: { clanId: faction.clanId },
        select: { id: true, name: true },
      }),
    ]);
    const nameByFactionId = new Map(factionNames.map((f) => [f.id, f.name]));
    const otherFactionByUser = new Map<string, string>();
    for (const t of taken) {
      if (t.factionId === faction.id) continue;
      otherFactionByUser.set(
        t.userId,
        t.faction?.name || nameByFactionId.get(t.factionId) || "другая фракция"
      );
    }
    const inThis = new Set(listed.map((m) => m.userId));
    // Весь клан BB (кроме уже в этой фракции): поиск видит всех; чужая фракция — с пометкой.
    invitePool = clanMembers
      .filter((m) => !isBuiltinSuperAdmin(m.user.steamId))
      .filter((m) => !inThis.has(m.user.id))
      .map((m) => {
        const blocked = otherFactionByUser.get(m.user.id) || null;
        return {
          id: m.user.id,
          nick: m.user.nick || m.user.steamName || "—",
          name: m.user.name || "",
          steamId: m.user.steamId || "",
          steamName: m.user.steamName || "",
          blockedIn: blocked,
        };
      });
    if (keech) {
      leaderPool = clanMembers
        .filter((m) => !isBuiltinSuperAdmin(m.user.steamId))
        .filter((m) => !otherFactionByUser.has(m.user.id))
        .map((m) => ({
          id: m.user.id,
          nick: m.user.nick || m.user.steamName || "—",
          name: m.user.name || "",
          steamId: m.user.steamId || "",
          steamName: m.user.steamName || "",
        }));
    }
  }

  const view: FactionView = {
    id: faction.id,
    clanId: faction.clanId,
    name: faction.name,
    slug: faction.slug,
    logoUrl: faction.logoUrl,
    tgUrl: faction.tgUrl,
    info: faction.info || "",
    blueberryBalance: faction.blueberryBalance ?? 0,
    leaderNick: leader?.nick ?? null,
    deputyNicks: deputies,
    roles: faction.roles.map((r) => ({ id: r.id, name: r.name, isDeputy: r.isDeputy })),
    members,
    canEditIdentity: keech,
    canManage: staff,
    canEditInfo: staff,
    mySeat,
    myUserId: me?.id ?? null,
    keech,
    invitePool,
    leaderPool,
  };
  return { error: null, view, me, factionId: faction.id, clanId: faction.clanId };
}

export function canTouchMember(
  actor: { keech: boolean; seat: FactionSeat | null },
  targetSeat: FactionSeat
): boolean {
  if (actor.keech) return true;
  if (actor.seat === "LEADER") return targetSeat !== "LEADER";
  if (actor.seat === "DEPUTY") return targetSeat !== "LEADER";
  return false;
}

export async function logFaction(
  kind: "join" | "kick",
  opts: {
    actorId: string | null;
    actorNick: string;
    targetId: string;
    targetNick: string;
    factionName: string;
    clanId: string;
    how?: string;
    /** Обязательна при исключении (командир / зам / админ). */
    reason?: string;
  }
) {
  const verb = kind === "join" ? "вступил в фракцию" : "исключён из фракции";
  const reason = (opts.reason || "").trim();
  const how = (opts.how || "").trim();
  const bits = [how, reason ? `причина: ${reason}` : ""].filter(Boolean);
  const tail = bits.length ? ` (${bits.join("; ")})` : "";
  await writeActionLog({
    category: "faction",
    action: kind === "join" ? "faction_join" : "faction_kick",
    message: `${opts.targetNick} ${verb} «${opts.factionName}»${tail}. Сделал ${opts.actorNick}.`,
    actorId: opts.actorId,
    actorNick: opts.actorNick,
    targetId: opts.targetId,
    targetNick: opts.targetNick,
    clanId: opts.clanId,
    clanTag: "BB",
    meta: {
      faction: opts.factionName,
      ...(reason ? { reason } : {}),
      ...(how ? { how } : {}),
    },
  });

  // Кик → жёлтое письмо СРИ главе / заму / Keech (с досье; не в общий журнал)
  if (kind === "kick") {
    try {
      const { notifyFactionKickMail } = await import("@/lib/sri");
      await notifyFactionKickMail({
        factionName: opts.factionName,
        clanId: opts.clanId,
        targetId: opts.targetId,
        targetNick: opts.targetNick,
        actorNick: opts.actorNick,
        reason: reason || undefined,
        how: how || undefined,
      });
    } catch (e) {
      console.error("sri kick notify failed", e);
    }
  }
}

export function actorNick(u: { nick?: string | null; name?: string | null; steamName?: string | null } | null, keech: boolean) {
  if (keech) return "Keech";
  return u ? personLabel(u) : "—";
}
