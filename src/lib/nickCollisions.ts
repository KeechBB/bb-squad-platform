/**
 * Одинаковый игровой ник у разных Steam — не склеивать истории профилей.
 * Пример: angel (Саня, BB) и Angel (Алан) оба играют как "angel" на табло.
 *
 * Саня [BB]: ник на сайте `angel`; старый slug AngelBB и ник → 301 на /players/<steamId>.
 */
import { prisma } from "@/lib/prisma";

export type NickCollision = {
  steamId: string;
  /** Точный ник аккаунта в User.nick. */
  siteNick: string;
  /** Слаг в /players/[slug] (может отличаться от siteNick). */
  profileSlug: string;
  /** Ключ ProfileMatchLine / ProfileMatchStamp — не lower(nick). */
  historyKey: string;
  /** Ник в public RP ledger / ladder. */
  publicNick: string;
};

/** Два Angel на сайте: Саня [BB] и Алан. */
export const ANGEL_COLLISIONS: readonly NickCollision[] = [
  {
    steamId: "76561198941350361",
    siteNick: "angel",
    profileSlug: "AngelBB",
    historyKey: "angel#76561198941350361",
    publicNick: "angel",
  },
  {
    steamId: "76561198421145708",
    siteNick: "Angel",
    profileSlug: "Angel",
    historyKey: "angel#76561198421145708",
    publicNick: "Angel 🪽",
  },
] as const;

const bySteam = new Map(ANGEL_COLLISIONS.map((c) => [c.steamId, c]));
const bySiteNickExact = new Map(ANGEL_COLLISIONS.map((c) => [c.siteNick, c]));
/** Только URL-слаги (AngelBB), без lower(siteNick) — иначе Angel/angel схлопнутся. */
const bySlugLower = new Map(
  ANGEL_COLLISIONS.map((c) => [c.profileSlug.toLowerCase(), c])
);

export function collisionBySteamId(
  steamId: string | null | undefined
): NickCollision | null {
  const s = String(steamId || "").trim();
  return s ? bySteam.get(s) || null : null;
}

/** По никку аккаунта или URL-слагу. */
export function collisionBySiteNick(
  nick: string | null | undefined
): NickCollision | null {
  const n = String(nick || "").trim();
  if (!n) return null;
  return (
    bySiteNickExact.get(n) || bySlugLower.get(n.toLowerCase()) || null
  );
}

export function isCollidingAngelNick(nick: string): boolean {
  return Boolean(collisionBySiteNick(nick));
}

/**
 * Канон URL-слага. Если в адресе `angel` — вернёт `AngelBB`,
 * чтобы редиректнуть на красивую ссылку без смены ника.
 */
export function canonicalProfileSlug(
  nick: string | null | undefined
): string | null {
  const hit = collisionBySiteNick(nick);
  return hit ? hit.profileSlug : null;
}

/** Реальный User.nick для загрузки профиля. */
export function resolveProfileAccountNick(
  urlNick: string | null | undefined
): string {
  const hit = collisionBySiteNick(urlNick);
  return hit ? hit.siteNick : String(urlNick || "").trim();
}

export function profileHistoryKey(
  nick: string,
  steamId?: string | null
): string {
  const bySteamHit = collisionBySteamId(steamId);
  if (bySteamHit) return bySteamHit.historyKey;
  const byNick = collisionBySiteNick(nick);
  if (byNick) return byNick.historyKey;
  return String(nick || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

export function publicRpLookupNick(
  nick: string,
  steamId?: string | null
): string {
  const hit = collisionBySteamId(steamId) || collisionBySiteNick(nick);
  return hit ? hit.publicNick : String(nick || "").trim();
}

async function loadSteamAngelDays(
  steamId: string,
  serverPrefix: "TR" | "TPUB"
): Promise<Set<string>> {
  const sid = String(steamId || "").trim();
  if (!sid) return new Set();
  const rows = await prisma.$queryRawUnsafe<Array<{ d: string }>>(
    `SELECT DISTINCT to_char(("spawnedAt" AT TIME ZONE 'Europe/Moscow'), 'YYYY-MM-DD') AS d
     FROM "SquadRoleEvent"
     WHERE "steamId" = $1
       AND lower(coalesce("nickAtSpawn", '')) LIKE '%angel%'
       AND "serverKey" LIKE $2`,
    sid,
    `${serverPrefix}%`
  );
  const out = new Set<string>();
  for (const r of rows) {
    const s = String(r.d || "").slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) out.add(s);
  }
  return out;
}

/** Дни (MSK YYYY-MM-DD), когда этот Steam заходил на TR как angel/Angel. */
export async function loadSteamAngelTrainDays(
  steamId: string
): Promise<Set<string>> {
  return loadSteamAngelDays(steamId, "TR");
}

/** Дни на PB1 (TPUB*), когда Steam был angel/Angel. */
export async function loadSteamAngelPublicDays(
  steamId: string
): Promise<Set<string>> {
  return loadSteamAngelDays(steamId, "TPUB");
}

export function matchYmdAllowed(
  ymd: string,
  allowed: Set<string> | null | undefined
): boolean {
  if (!allowed) return true;
  if (!allowed.size) return false;
  return allowed.has(String(ymd || "").slice(0, 10));
}
