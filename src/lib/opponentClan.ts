/**
 * Чужие кланы с КВ (TR1/TR2 авто / скрины).
 * Канон: .cursor/rules/kv-tr-both-teams-auto.mdc
 */
import { readFile } from "fs/promises";
import path from "path";
import { prisma } from "@/lib/prisma";
import { canonOpp, clanLogoUrl } from "@/lib/clanLogo";
import { saveClanLogo, detectClanLogoMime } from "@/lib/clanLogoFile";
import { ensureDefaultSquads } from "@/lib/squads";
import { ensureDefaultTitles } from "@/lib/titles";
import { nickKey, nickCompact } from "@/lib/nickIdentity";

const HOLDER_STEAM = "76561199000000001";
const HOLDER_NICK = "BB-ClanHolder";

const BRAND_LOGO_FILES: Record<string, string[]> = {
  "20R": ["20royals.png"],
  AVG: ["avg.png"],
  DCAI: ["dcai.jpg"],
  HELL: ["hell.jpg"],
  TWO: ["two.jpg"],
  "44th": ["44th.jpg"],
  IH: ["ih.jpg"],
  GM: ["gm.jpg"],
  HQ: ["hq.png"],
  H1GH: ["h1gh.jpg"],
  ALPHA: ["alpha.png"],
  SPH: ["sph.png"],
  FURY: ["fury.png"],
  IMP: ["imp.png", "imp.jpg"],
  OMEN: ["omen.png"],
  FAL: ["fal.png"],
  FOX: ["fox.png"],
  SOLID: ["solid.png", "solid.jpg"],
};

function dbTag(raw: string): string {
  const c = canonOpp(raw);
  // Prisma tag: 2–8 alnum (clan.ts). Strip dots.
  return c.tag.replace(/[^A-Za-z0-9]/g, "").slice(0, 8).toUpperCase() || c.key;
}

async function ensureHolderUserId(): Promise<string> {
  const existing = await prisma.user.findUnique({
    where: { steamId: HOLDER_STEAM },
    select: { id: true },
  });
  if (existing) return existing.id;
  const created = await prisma.user.create({
    data: {
      steamId: HOLDER_STEAM,
      nick: HOLDER_NICK,
      name: "Clan card holder",
      steamName: HOLDER_NICK,
      profileComplete: true,
      role: "SUPER_ADMIN",
    },
    select: { id: true },
  });
  return created.id;
}

async function copyBrandLogo(clanId: string, logoKey: string): Promise<string | null> {
  const files = BRAND_LOGO_FILES[logoKey] || [];
  const roots = [
    path.join(process.cwd(), "..", "brand", "logos"),
    path.join(process.cwd(), "brand", "logos"),
    path.join(process.cwd(), "..", "..", "brand", "logos"),
    "D:\\BlackBerry\\Новый Проект Кича\\brand\\logos",
  ];
  for (const root of roots) {
    for (const file of files) {
      const full = path.join(root, file);
      try {
        const buf = await readFile(full);
        const mime = detectClanLogoMime(buf);
        if (mime) return await saveClanLogo(clanId, buf, mime);
        // jpg from brand → store as png path won't work; skip non-png/webp for saveClanLogo
        // Convert via sharp? Keep rating-logos URL fallback instead.
      } catch {
        /* try next */
      }
    }
  }
  // Fallback: public rating-logos (already png)
  const pub = clanLogoUrl(logoKey);
  if (pub) {
    const fileName = pub.replace(/^\/rating-logos\//, "").split("?")[0];
    const candidates = [
      path.join(process.cwd(), "public", "rating-logos", fileName),
      path.join(process.cwd(), "..", "platform", "public", "rating-logos", fileName),
    ];
    for (const full of candidates) {
      try {
        const buf = await readFile(full);
        const mime = detectClanLogoMime(buf);
        if (mime) return await saveClanLogo(clanId, buf, mime);
      } catch {
        /* next */
      }
    }
    return pub;
  }
  return null;
}

export type OppPlayerIn = {
  nick: string;
  steamId?: string | null;
  matchId?: string | null;
};

export type EnsureOpponentClanResult = {
  ok: boolean;
  clanId: string | null;
  tag: string;
  name: string;
  created: boolean;
  pendingUpserted: number;
  membersLinked: number;
  message: string;
};

/**
 * Создать/обновить карточку чужого клана + pending ростер.
 * Зареганных с тем же ником/steam сразу в ClanMember.
 */
const EXTERNAL_LEADER_STEAM_PREFIX = "7656119900001";

/** Синтетический user для отображения «Глава: …» у external-клана. */
async function ensureExternalLeaderUser(
  tag: string,
  leaderNick: string
): Promise<string> {
  const nick = leaderNick.trim() || "—";
  // уникальный steam на тег клана (не пересекается с реальными)
  const digits = Array.from(tag.toUpperCase())
    .map((c) => String(c.charCodeAt(0) % 10))
    .join("")
    .padEnd(4, "0")
    .slice(0, 4);
  const steamId = `${EXTERNAL_LEADER_STEAM_PREFIX}${digits}`.slice(0, 17);
  const existing = await prisma.user.findUnique({
    where: { steamId },
    select: { id: true },
  });
  if (existing) {
    await prisma.user.update({
      where: { id: existing.id },
      data: { nick, steamName: nick, name: nick, profileComplete: true },
    });
    return existing.id;
  }
  const created = await prisma.user.create({
    data: {
      steamId,
      nick,
      name: nick,
      steamName: nick,
      profileComplete: true,
      role: "USER",
    },
    select: { id: true },
  });
  return created.id;
}

function nickLooseMatch(a: string, b: string): boolean {
  const ka = nickKey(a);
  const kb = nickKey(b);
  if (ka && kb && ka === kb) return true;
  const ca = nickCompact(a);
  const cb = nickCompact(b);
  if (ca && cb && (ca === cb || ca.includes(cb) || cb.includes(ca))) return true;
  const la = a.trim().toLowerCase();
  const lb = b.trim().toLowerCase();
  if (!la || !lb) return false;
  return la === lb || la.includes(lb) || lb.includes(la);
}

/** Реальный зареганный юзер под ником главы (не синтетический 7656119900001…). */
async function findRealLeaderUser(leaderNick: string) {
  const nick = leaderNick.trim();
  if (!nick) return null;
  const users = await prisma.user.findMany({
    where: {
      profileComplete: true,
      NOT: { steamId: { startsWith: EXTERNAL_LEADER_STEAM_PREFIX } },
      OR: [
        { nick: { contains: nick, mode: "insensitive" } },
        { steamName: { contains: nick, mode: "insensitive" } },
      ],
    },
    select: { id: true, nick: true, steamName: true, steamId: true },
    take: 40,
  });
  return (
    users.find((u) =>
      nickLooseMatch(u.nick || u.steamName || "", nick)
    ) || null
  );
}

/**
 * Назначить отображаемого главу чужого клана (карточка КВ).
 * Если есть реальный зареганный с этим ником — он глава (без фиктивного user).
 * Технический holder остаётся скрытым MEMBER.
 */
export async function setExternalClanLeader(
  clanId: string,
  leaderNick: string
): Promise<{ ok: boolean; leaderNick: string }> {
  const nick = leaderNick.trim();
  if (!nick) return { ok: false, leaderNick: "" };

  const clan = await prisma.clan.findUnique({
    where: { id: clanId },
    select: { id: true, tag: true, isExternal: true, leaderId: true },
  });
  if (!clan?.isExternal) return { ok: false, leaderNick: nick };

  const holderId = await ensureHolderUserId();
  const real = await findRealLeaderUser(nick);
  const leaderUserId =
    real?.id || (await ensureExternalLeaderUser(clan.tag, nick));
  const displayNick = (real?.nick || nick).trim();

  await prisma.clan.update({
    where: { id: clanId },
    data: { leaderId: leaderUserId },
  });

  await prisma.clanMember.upsert({
    where: { clanId_userId: { clanId, userId: leaderUserId } },
    create: { clanId, userId: leaderUserId, role: "LEADER" },
    update: { role: "LEADER" },
  });

  // holder больше не LEADER
  if (holderId !== leaderUserId) {
    await prisma.clanMember.upsert({
      where: { clanId_userId: { clanId, userId: holderId } },
      create: { clanId, userId: holderId, role: "MEMBER" },
      update: { role: "MEMBER" },
    });
  }

  // убрать фиктивного главу из состава, если нашли реального
  if (real) {
    const synthSteam = `${EXTERNAL_LEADER_STEAM_PREFIX}${Array.from(
      clan.tag.toUpperCase()
    )
      .map((c) => String(c.charCodeAt(0) % 10))
      .join("")
      .padEnd(4, "0")
      .slice(0, 4)}`.slice(0, 17);
    const synth = await prisma.user.findUnique({
      where: { steamId: synthSteam },
      select: { id: true },
    });
    if (synth && synth.id !== leaderUserId) {
      await prisma.clanMember.deleteMany({
        where: { clanId, userId: synth.id },
      });
    }
    // на всякий случай — любой синтетический LEADER в этом клане
    const fakeLeaders = await prisma.clanMember.findMany({
      where: {
        clanId,
        role: "LEADER",
        user: { steamId: { startsWith: EXTERNAL_LEADER_STEAM_PREFIX } },
      },
      select: { userId: true },
    });
    for (const f of fakeLeaders) {
      if (f.userId === leaderUserId) continue;
      await prisma.clanMember.delete({
        where: { clanId_userId: { clanId, userId: f.userId } },
      });
    }
  }

  return { ok: true, leaderNick: displayNick };
}

export async function ensureOpponentClan(opts: {
  opp: string;
  players?: OppPlayerIn[];
  /** Отображаемый глава (ник), для external-карточки */
  leaderNick?: string | null;
}): Promise<EnsureOpponentClanResult> {
  const canon = canonOpp(opts.opp);
  const tag = dbTag(opts.opp);
  const name = canon.name;
  const logoKey = canon.key;

  let clan = await prisma.clan.findFirst({
    where: {
      OR: [
        { tag },
        { tag: { equals: tag, mode: "insensitive" } },
        { name: { equals: name, mode: "insensitive" } },
      ],
    },
  });

  let created = false;
  if (!clan) {
    const holderId = await ensureHolderUserId();
    clan = await prisma.clan.create({
      data: {
        name,
        tag,
        leaderId: holderId,
        isExternal: true,
        members: {
          create: { userId: holderId, role: "LEADER" },
        },
      },
    });
    created = true;
    // external: без авто-Main/Junior (ensureDefaultSquads их сразу снесёт)
    await ensureDefaultSquads(clan.id);
    await ensureDefaultTitles(clan.id);
    const logoUrl = await copyBrandLogo(clan.id, logoKey);
    if (logoUrl) {
      clan = await prisma.clan.update({
        where: { id: clan.id },
        data: { logoUrl },
      });
    }
  } else if (!clan.isExternal) {
    // не перезаписываем живой клан (напр. если кто-то создал вручную)
    return {
      ok: true,
      clanId: clan.id,
      tag: clan.tag,
      name: clan.name,
      created: false,
      pendingUpserted: 0,
      membersLinked: 0,
      message: `Клан [${clan.tag}] уже есть (не external) — только pending/link`,
    };
  } else if (!clan.logoUrl) {
    const logoUrl = await copyBrandLogo(clan.id, logoKey);
    if (logoUrl) {
      await prisma.clan.update({ where: { id: clan.id }, data: { logoUrl } });
    }
  }

  const players = opts.players || [];
  let pendingUpserted = 0;
  for (const p of players) {
    const nick = String(p.nick || "").trim();
    if (!nick) continue;
    const nk = nickKey(nick);
    if (!nk) continue;
    await prisma.clanPendingMember.upsert({
      where: { clanId_nickKey: { clanId: clan.id, nickKey: nk } },
      create: {
        clanId: clan.id,
        nick,
        nickKey: nk,
        steamId: p.steamId || null,
        matchId: p.matchId || null,
      },
      update: {
        nick,
        steamId: p.steamId || undefined,
        matchId: p.matchId || undefined,
      },
    });
    pendingUpserted += 1;
  }

  const membersLinked = await linkRegisteredPlayersToClan(clan.id);

  const leaderNick = String(opts.leaderNick || "").trim();
  if (leaderNick && clan.isExternal) {
    await setExternalClanLeader(clan.id, leaderNick);
  }

  return {
    ok: true,
    clanId: clan.id,
    tag: clan.tag,
    name: clan.name,
    created,
    pendingUpserted,
    membersLinked,
    message: created
      ? `Создан [${tag}] ${name}, pending=${pendingUpserted}, linked=${membersLinked}`
      : `Обновлён [${tag}], pending=${pendingUpserted}, linked=${membersLinked}`,
  };
}

/** Зареганные с ником/steam из pending → ClanMember (не трогаем другие кланы). */
export async function linkRegisteredPlayersToClan(clanId: string): Promise<number> {
  const pending = await prisma.clanPendingMember.findMany({
    where: { clanId },
  });
  if (!pending.length) return 0;

  const steamIds = pending.map((p) => p.steamId).filter(Boolean) as string[];
  const nickKeys = pending.map((p) => p.nickKey);
  const nickCompacts = pending.map((p) => nickCompact(p.nick));

  const users = await prisma.user.findMany({
    where: {
      profileComplete: true,
      OR: [
        ...(steamIds.length ? [{ steamId: { in: steamIds } }] : []),
        { nick: { not: null } },
        { steamName: { not: null } },
      ],
    },
    select: { id: true, steamId: true, nick: true, steamName: true },
  });

  const want = new Set(nickKeys);
  const wantC = new Set(nickCompacts);
  const wantSteam = new Set(steamIds);

  const matched = users.filter((u) => {
    if (wantSteam.has(u.steamId)) return true;
    const label = (u.nick || u.steamName || "").trim();
    if (!label) return false;
    return want.has(nickKey(label)) || wantC.has(nickCompact(label));
  });

  if (!matched.length) return 0;

  const holder = await prisma.user.findUnique({
    where: { steamId: HOLDER_STEAM },
    select: { id: true },
  });
  const ids = matched.map((u) => u.id).filter((id) => id !== holder?.id);

  const memberships = await prisma.clanMember.findMany({
    where: { userId: { in: ids } },
    select: { userId: true, clanId: true },
  });
  const inAny = new Set(memberships.map((m) => m.userId));
  const toAdd = ids.filter((id) => !inAny.has(id));

  if (toAdd.length) {
    await prisma.clanMember.createMany({
      data: toAdd.map((userId) => ({
        clanId,
        userId,
        role: "MEMBER" as const,
      })),
      skipDuplicates: true,
    });
  }
  return toAdd.length;
}

/**
 * После регистрации: если ник/steam в pending чужого клана — сразу в составе.
 * Не трогает тех, кто уже в любом клане (в т.ч. BB).
 */
export async function attachOpponentClanOnRegister(userId: string): Promise<{
  joined: boolean;
  clanId: string | null;
  tag: string | null;
}> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, steamId: true, nick: true, steamName: true },
  });
  if (!user) return { joined: false, clanId: null, tag: null };

  const already = await prisma.clanMember.findFirst({
    where: { userId },
    select: { id: true },
  });
  if (already) return { joined: false, clanId: null, tag: null };

  const label = (user.nick || user.steamName || "").trim();
  const nk = nickKey(label);
  const nc = nickCompact(label);

  let pending = await prisma.clanPendingMember.findFirst({
    where: {
      OR: [
        { steamId: user.steamId },
        ...(nk ? [{ nickKey: nk }] : []),
      ],
    },
    include: { clan: { select: { id: true, tag: true, isExternal: true } } },
    orderBy: { updatedAt: "desc" },
  });

  if (!pending && nc) {
    const all = await prisma.clanPendingMember.findMany({
      include: { clan: { select: { id: true, tag: true, isExternal: true } } },
      orderBy: { updatedAt: "desc" },
      take: 5000,
    });
    pending =
      all.find((p) => nickCompact(p.nick) === nc && p.clan.isExternal) || null;
  }

  if (!pending?.clan?.isExternal) {
    return { joined: false, clanId: null, tag: null };
  }

  // Закрепить Steam на pending-нике с табло — рейтинг/история склеят по Steam.
  if (!pending.steamId || pending.steamId !== user.steamId) {
    await prisma.clanPendingMember.update({
      where: { id: pending.id },
      data: { steamId: user.steamId },
    });
  }

  await prisma.clanMember.create({
    data: {
      clanId: pending.clanId,
      userId,
      role: "MEMBER",
    },
  });

  return {
    joined: true,
    clanId: pending.clan.id,
    tag: pending.clan.tag,
  };
}

export async function listPendingForClan(clanId: string) {
  const [pending, members] = await Promise.all([
    prisma.clanPendingMember.findMany({
      where: { clanId },
      orderBy: { nick: "asc" },
      select: {
        id: true,
        nick: true,
        steamId: true,
        matchId: true,
        createdAt: true,
      },
    }),
    prisma.clanMember.findMany({
      where: { clanId },
      include: {
        user: {
          select: { nick: true, steamName: true, steamId: true },
        },
      },
    }),
  ]);

  const memberSteams = new Set(
    members
      .map((m) => m.user.steamId)
      .filter(
        (s) => s && !s.startsWith(EXTERNAL_LEADER_STEAM_PREFIX) && s !== HOLDER_STEAM
      )
  );
  const memberLabels = members
    .filter(
      (m) =>
        m.user.steamId &&
        !m.user.steamId.startsWith(EXTERNAL_LEADER_STEAM_PREFIX) &&
        m.user.steamId !== HOLDER_STEAM
    )
    .map((m) => (m.user.nick || m.user.steamName || "").trim())
    .filter(Boolean);

  return pending.filter((p) => {
    if (p.steamId && memberSteams.has(p.steamId)) return false;
    const label = (p.nick || "").trim();
    if (!label) return false;
    return !memberLabels.some((m) => nickLooseMatch(m, label));
  });
}
