import { prisma } from "@/lib/prisma";
import { effectiveRole, type AppRole } from "@/lib/admin";
import { clanMapColor, normalizeClanTag } from "@/lib/clanMapColor";

export type RosterPaintRights = "admin" | "moderator" | "camera" | "";

type PaintPlayer = {
  steamId?: string;
  name?: string;
  rights?: string;
  clanColor?: string | null;
};

type PaintTeam = {
  squads?: { players?: PaintPlayer[] }[];
  loose?: PaintPlayer[];
};

/** Тег из ника: [BB], •HIVE•, (ХУХ) */
export function clanTagFromNick(name: string): string | null {
  const raw = String(name || "").trim();
  if (!raw) return null;
  const bracket = raw.match(/^\[([^\]]{1,16})\]/);
  if (bracket) return normalizeClanTag(bracket[1]) || null;
  const bullets = raw.match(/^•\s*([^\s•]{1,16})\s*•/);
  if (bullets) return normalizeClanTag(bullets[1]) || null;
  const parens = raw.match(/^\(([^\)]{1,16})\)/);
  if (parens) return normalizeClanTag(parens[1]) || null;
  return null;
}

function collectSteamIds(teams: PaintTeam[]): string[] {
  const ids = new Set<string>();
  for (const team of teams) {
    for (const squad of team.squads || []) {
      for (const p of squad.players || []) {
        if (p.steamId) ids.add(p.steamId);
      }
    }
    for (const p of team.loose || []) {
      if (p.steamId) ids.add(p.steamId);
    }
  }
  return [...ids];
}

function paintPlayer(
  player: PaintPlayer,
  site: Map<string, { role: AppRole; clanId: string; clanTag: string }>
) {
  const sid = String(player.steamId || "");
  const gameRight = String(player.rights || "");
  const row = sid ? site.get(sid) : undefined;

  let rights: RosterPaintRights = "";
  if (row?.role === "SUPER_ADMIN" || row?.role === "PUBLIC_ADMIN") {
    rights = "admin";
  } else if (row?.role === "PUBLIC_MOD") {
    rights = "moderator";
  } else if (gameRight === "camera") {
    rights = "camera";
  }

  let clanColor: string | null = null;
  if (!rights) {
    if (row?.clanTag) {
      clanColor = clanMapColor(row.clanId || row.clanTag, row.clanTag);
    } else {
      const tag = clanTagFromNick(String(player.name || ""));
      if (tag) clanColor = clanMapColor(tag, tag);
    }
  }

  player.rights = rights;
  player.clanColor = clanColor;
}

/** Сайт-роли + цвет клана поверх staff из Admins.cfg (камера). */
export async function enrichPanelkaRosterPaint<T extends { teams?: PaintTeam[] }>(
  data: T
): Promise<T> {
  const teams = data?.teams;
  if (!Array.isArray(teams) || !teams.length) return data;

  const steamIds = collectSteamIds(teams);
  const site = new Map<string, { role: AppRole; clanId: string; clanTag: string }>();
  if (steamIds.length) {
    const users = await prisma.user.findMany({
      where: { steamId: { in: steamIds } },
      select: {
        steamId: true,
        role: true,
        clanMemberships: {
          take: 1,
          select: { clan: { select: { id: true, tag: true } } },
        },
      },
    });
    for (const u of users) {
      if (!u.steamId) continue;
      const clan = u.clanMemberships[0]?.clan;
      site.set(u.steamId, {
        role: effectiveRole(u.steamId, u.role as AppRole),
        clanId: clan?.id || "",
        clanTag: clan?.tag || "",
      });
    }
  }

  for (const team of teams) {
    for (const squad of team.squads || []) {
      for (const p of squad.players || []) paintPlayer(p, site);
    }
    for (const p of team.loose || []) paintPlayer(p, site);
  }
  return data;
}
