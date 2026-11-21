import { prisma } from "@/lib/prisma";

const STEAM_RE = /^7656\d{13}$/;

export type SteamNickRow = {
  nick: string;
  firstSeenAt: string;
  lastSeenAt: string;
  seenCount: number;
  source: string;
};

export function nickKeyOf(raw: string): string {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .slice(0, 64);
}

export function cleanNick(raw: string): string {
  return String(raw || "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 48);
}

/** Upsert one nick sighting. Never deletes — Steam history wipe does not touch us. */
export async function recordSteamNick(
  steamId: string,
  nickRaw: string,
  source = "panelka"
): Promise<void> {
  if (!STEAM_RE.test(steamId)) return;
  const nick = cleanNick(nickRaw);
  const nickKey = nickKeyOf(nick);
  if (!nick || nickKey.length < 1) return;
  try {
    await prisma.steamNickHistory.upsert({
      where: { steamId_nickKey: { steamId, nickKey } },
      create: {
        steamId,
        nick,
        nickKey,
        source: source.slice(0, 24),
        seenCount: 1,
      },
      update: {
        nick,
        lastSeenAt: new Date(),
        seenCount: { increment: 1 },
        // keep earliest source; only refresh if still panelka-ish
        ...(source === "panelka" ? {} : {}),
      },
    });
  } catch {
    /* ignore — card must still open */
  }
}

export async function recordSteamNicks(
  rows: { steamId: string; nick: string; source?: string }[]
): Promise<void> {
  const seen = new Set<string>();
  const jobs: Promise<void>[] = [];
  for (const row of rows) {
    const key = `${row.steamId}|${nickKeyOf(row.nick)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    jobs.push(recordSteamNick(row.steamId, row.nick, row.source || "panelka"));
  }
  // Chunked parallel — don't stall event loop on 100 upserts
  const size = 25;
  for (let i = 0; i < jobs.length; i += size) {
    await Promise.all(jobs.slice(i, i + size));
  }
}

/** Seed history table from existing sessions / roles / site profile (once per call, cheap). */
async function backfillFromSite(steamId: string): Promise<void> {
  const [sessions, roles, eos, user] = await Promise.all([
    prisma.squadServerSession.findMany({
      where: { steamId, nickAtJoin: { not: null } },
      select: { nickAtJoin: true, joinedAt: true },
      orderBy: { joinedAt: "desc" },
      take: 400,
    }),
    prisma.squadRoleEvent.findMany({
      where: { steamId, nickAtSpawn: { not: null } },
      select: { nickAtSpawn: true, spawnedAt: true },
      orderBy: { spawnedAt: "desc" },
      take: 200,
    }),
    prisma.squadEosSteamMap.findMany({
      where: { steamId, nick: { not: null } },
      select: { nick: true, updatedAt: true },
      take: 20,
    }),
    prisma.user.findFirst({
      where: { steamId },
      select: { nick: true, steamName: true, name: true },
    }),
  ]);

  for (const s of sessions) {
    if (s.nickAtJoin) await recordSteamNick(steamId, s.nickAtJoin, "session");
  }
  for (const r of roles) {
    if (r.nickAtSpawn) await recordSteamNick(steamId, r.nickAtSpawn, "role");
  }
  for (const e of eos) {
    if (e.nick) await recordSteamNick(steamId, e.nick, "eos");
  }
  if (user?.nick) await recordSteamNick(steamId, user.nick, "site");
  if (user?.steamName) await recordSteamNick(steamId, user.steamName, "site");
  if (user?.name) await recordSteamNick(steamId, user.name, "site");
}

export async function listSteamNickHistory(
  steamId: string,
  currentNick?: string
): Promise<SteamNickRow[]> {
  if (!STEAM_RE.test(steamId)) return [];
  if (currentNick) await recordSteamNick(steamId, currentNick, "panelka");

  let rows = await prisma.steamNickHistory.findMany({
    where: { steamId },
    orderBy: { lastSeenAt: "desc" },
    take: 40,
  });
  if (rows.length < 2) {
    await backfillFromSite(steamId);
    if (currentNick) await recordSteamNick(steamId, currentNick, "panelka");
    rows = await prisma.steamNickHistory.findMany({
      where: { steamId },
      orderBy: { lastSeenAt: "desc" },
      take: 40,
    });
  }

  // Collapse exact nickKey duplicates (should already be unique)
  const out: SteamNickRow[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.nickKey)) continue;
    seen.add(row.nickKey);
    out.push({
      nick: row.nick,
      firstSeenAt: row.firstSeenAt.toISOString(),
      lastSeenAt: row.lastSeenAt.toISOString(),
      seenCount: row.seenCount,
      source: row.source,
    });
  }
  return out;
}
