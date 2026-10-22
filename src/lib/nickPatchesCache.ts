import { promises as fs } from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import {
  normalizeProfilePatch,
  profilePatchTip,
  profilePatchUrl,
} from "@/lib/profilePatches";
import { normalizeProfileNickStyle } from "@/lib/profileNickStyles";

export type NickPatchPublicRow = {
  nick: string;
  steamId: string;
  patchId: string | null;
  url: string;
  tip: string;
  styleId: string | null;
};

/** Снимок оформления ника для рейтингов (паблик / КВ / ТМ). */
export async function writeNickPatchesCache(): Promise<NickPatchPublicRow[]> {
  const users = await prisma.user.findMany({
    where: {
      profileComplete: true,
      nick: { not: null },
      OR: [{ nickPatch: { not: null } }, { nickStyle: { not: null } }],
    },
    select: {
      nick: true,
      steamId: true,
      nickPatch: true,
      nickStyle: true,
    },
  });

  const rows: NickPatchPublicRow[] = [];
  for (const u of users) {
    const patchId = normalizeProfilePatch(u.nickPatch);
    const url = profilePatchUrl(patchId);
    const styleId = normalizeProfileNickStyle(u.nickStyle);
    const nick = String(u.nick || "").trim();
    if ((!patchId && !styleId) || !nick) continue;
    rows.push({
      nick,
      steamId: u.steamId,
      patchId,
      url: url || "",
      tip: patchId ? profilePatchTip(patchId) : "",
      styleId,
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

function rowFromUser(u: {
  nick: string | null;
  steamId: string;
  nickPatch: string | null;
  nickStyle: string | null;
}): NickPatchPublicRow | null {
  const patchId = normalizeProfilePatch(u.nickPatch);
  const url = profilePatchUrl(patchId);
  const styleId = normalizeProfileNickStyle(u.nickStyle);
  if (!patchId && !styleId) return null;
  return {
    nick: String(u.nick || ""),
    steamId: u.steamId,
    patchId,
    url: url || "",
    tip: patchId ? profilePatchTip(patchId) : "",
    styleId,
  };
}

async function loadNickPatchUsers() {
  return prisma.user.findMany({
    where: {
      profileComplete: true,
      OR: [{ nickPatch: { not: null } }, { nickStyle: { not: null } }],
    },
    select: {
      nick: true,
      steamId: true,
      nickPatch: true,
      nickStyle: true,
    },
  });
}

export async function loadNickPatchBySteam(): Promise<
  Map<string, NickPatchPublicRow>
> {
  const users = await loadNickPatchUsers();
  const map = new Map<string, NickPatchPublicRow>();
  for (const u of users) {
    const row = rowFromUser(u);
    if (!row) continue;
    map.set(u.steamId, row);
  }
  return map;
}

/** Ник → нашивка/стиль (ключ = lower(nick)). */
export async function loadNickPatchByNick(): Promise<
  Map<string, NickPatchPublicRow>
> {
  const users = await loadNickPatchUsers();
  const map = new Map<string, NickPatchPublicRow>();
  for (const u of users) {
    const row = rowFromUser(u);
    if (!row) continue;
    const key = String(u.nick || "")
      .trim()
      .toLowerCase();
    if (!key) continue;
    map.set(key, row);
  }
  return map;
}
