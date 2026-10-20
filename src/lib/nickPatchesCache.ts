import { promises as fs } from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import {
  normalizeProfilePatch,
  profilePatchTip,
  profilePatchUrl,
} from "@/lib/profilePatches";

export type NickPatchPublicRow = {
  nick: string;
  steamId: string;
  patchId: string;
  url: string;
  tip: string;
};

/** Снимок нашивок для рейтингов (паблик / КВ / ТМ). */
export async function writeNickPatchesCache(): Promise<NickPatchPublicRow[]> {
  const users = await prisma.user.findMany({
    where: {
      profileComplete: true,
      nick: { not: null },
      nickPatch: { not: null },
    },
    select: { nick: true, steamId: true, nickPatch: true },
  });

  const rows: NickPatchPublicRow[] = [];
  for (const u of users) {
    const patchId = normalizeProfilePatch(u.nickPatch);
    const url = profilePatchUrl(patchId);
    const nick = String(u.nick || "").trim();
    if (!patchId || !url || !nick) continue;
    rows.push({
      nick,
      steamId: u.steamId,
      patchId,
      url,
      tip: profilePatchTip(patchId),
    });
  }

  const payload = {
    updatedAt: new Date().toISOString(),
    rows,
    bySteam: Object.fromEntries(rows.map((r) => [r.steamId, r])),
    byNick: Object.fromEntries(
      rows.map((r) => [r.nick.trim().toLowerCase(), r])
    ),
  };

  const roots = [
    path.join(process.cwd(), "data", "public"),
    path.join(process.cwd(), "data", "kv-cache", "data"),
    "/var/www/blackberry-kv/public/data",
    "/var/www/blackberry-kv/data",
  ];
  const body = JSON.stringify(payload, null, 2) + "\n";
  for (const dir of roots) {
    try {
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, "nick-patches.json"), body, "utf8");
    } catch (e) {
      console.warn("[nickPatchesCache] write failed", dir, e);
    }
  }
  return rows;
}

export async function loadNickPatchBySteam(): Promise<
  Map<string, NickPatchPublicRow>
> {
  const users = await prisma.user.findMany({
    where: {
      profileComplete: true,
      nickPatch: { not: null },
    },
    select: { nick: true, steamId: true, nickPatch: true },
  });
  const map = new Map<string, NickPatchPublicRow>();
  for (const u of users) {
    const patchId = normalizeProfilePatch(u.nickPatch);
    const url = profilePatchUrl(patchId);
    if (!patchId || !url) continue;
    map.set(u.steamId, {
      nick: String(u.nick || ""),
      steamId: u.steamId,
      patchId,
      url,
      tip: profilePatchTip(patchId),
    });
  }
  return map;
}
