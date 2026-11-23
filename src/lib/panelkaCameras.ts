import { prisma } from "@/lib/prisma";
import { runPanelka } from "@/lib/panelkaRcon";

const STEAM_RE = /^7656\d{13}$/;

export type CameraRow = {
  steamId: string;
  nick: string | null;
  byNick: string;
  grantedAt: string | null;
  note: string | null;
  source: "cfg";
  panelka?: boolean;
};

async function resolveNicks(steamIds: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(steamIds.filter((s) => STEAM_RE.test(s)))];
  const map = new Map<string, string>();
  if (!ids.length) return map;
  const users = await prisma.user.findMany({
    where: { steamId: { in: ids } },
    select: { steamId: true, nick: true, steamName: true },
  });
  for (const u of users) {
    const nick = (u.nick || u.steamName || "").trim();
    if (nick) map.set(u.steamId, nick);
  }
  const missing = ids.filter((id) => !map.has(id));
  if (missing.length) {
    const sessions = await prisma.squadServerSession.findMany({
      where: { steamId: { in: missing }, nickAtJoin: { not: null } },
      select: { steamId: true, nickAtJoin: true, joinedAt: true },
      orderBy: { joinedAt: "desc" },
      take: 800,
    });
    for (const s of sessions) {
      if (map.has(s.steamId)) continue;
      const nick = (s.nickAtJoin || "").trim();
      if (nick) map.set(s.steamId, nick);
    }
  }
  return map;
}

export async function listPublicCameras(): Promise<CameraRow[]> {
  const cfg = (await runPanelka(["cameras-list"], 25000)) as {
    ok?: boolean;
    cameras?: {
      steamId: string;
      byNick?: string;
      grantedAt?: string;
      note?: string;
      name?: string;
      panelka?: boolean;
    }[];
    error?: string;
  };
  if (!cfg?.ok) throw new Error(cfg?.error || "не удалось прочитать камеры");
  const list = cfg.cameras || [];
  const nickMap = await resolveNicks(list.map((c) => c.steamId));
  return list.map((c) => ({
    steamId: c.steamId,
    nick:
      (c.name || "").replace(/_/g, " ").trim() ||
      nickMap.get(c.steamId) ||
      null,
    byNick: (c.byNick || "").replace(/_/g, " ") || "—",
    grantedAt: c.grantedAt || null,
    note: (c.note || "").trim() || null,
    source: "cfg" as const,
    panelka: Boolean(c.panelka),
  }));
}

export async function grantPublicCamera(opts: {
  steamId: string;
  nick?: string;
  byNick: string;
  bySteamId?: string;
  note?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!STEAM_RE.test(opts.steamId)) {
    return { ok: false, error: "укажи Steam ID" };
  }
  const res = (await runPanelka(["camera-add", opts.steamId], 30000, {
    byNick: opts.byNick,
    bySteamId: opts.bySteamId || "",
    name: (opts.nick || "").slice(0, 48),
    note: (opts.note || "").slice(0, 120),
    granted: new Date().toISOString().slice(0, 19),
  })) as { ok?: boolean; error?: string; reply?: string; alreadyStaff?: boolean };
  if (res?.ok === false) {
    return { ok: false, error: res.error || "не выдалось" };
  }
  return { ok: true };
}

export async function revokePublicCamera(opts: {
  steamId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!STEAM_RE.test(opts.steamId)) {
    return { ok: false, error: "укажи Steam ID" };
  }
  const res = (await runPanelka(["camera-remove", opts.steamId], 25000)) as {
    ok?: boolean;
    error?: string;
  };
  if (res?.ok === false) {
    return { ok: false, error: res.error || "не снялось" };
  }
  return { ok: true };
}
