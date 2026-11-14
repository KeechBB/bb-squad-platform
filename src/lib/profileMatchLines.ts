/**
 * Flat profile history. One row per player match, written when the history
 * is built, read with LIMIT/OFFSET. The page does not assemble the model.
 */
import { prisma } from "@/lib/prisma";
import { trainHistoryChronoKey } from "@/lib/homeTrainPwr";
import {
  collisionBySiteNick,
  collisionBySteamId,
  isCollidingAngelNick,
  profileHistoryKey,
  publicRpLookupNick,
  type NickCollision,
} from "@/lib/nickCollisions";
import type { Prisma } from "@prisma/client";

export type ProfileHistoryKind = "public" | "train" | "cw";

const KINDS = new Set<ProfileHistoryKind>(["public", "train", "cw"]);

export function isProfileHistoryKind(v: string): v is ProfileHistoryKind {
  return KINDS.has(v as ProfileHistoryKind);
}

async function resolveCollision(nick: string): Promise<NickCollision | null> {
  const clean = String(nick || "").trim();
  const exact = collisionBySiteNick(clean);
  if (exact) return exact;
  if (!isCollidingAngelNick(clean)) return null;
  const users = await prisma.user.findMany({
    where: {
      nick: { equals: clean, mode: "insensitive" },
      profileComplete: true,
    },
    select: { nick: true, steamId: true },
    take: 8,
  });
  const preferred =
    users.find((u) => u.nick === clean) ||
    users.find((u) => collisionBySteamId(u.steamId)) ||
    users[0];
  return collisionBySteamId(preferred?.steamId);
}

async function historyKeyFor(nick: string): Promise<string> {
  const hit = await resolveCollision(nick);
  if (hit) return hit.historyKey;
  return profileHistoryKey(nick);
}

function playedOn(dateLabel: string): string {
  const d = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(String(dateLabel || "").trim());
  return d ? `${d[3]}-${d[2]}-${d[1]}` : "0000-00-00";
}

type AnyRow = {
  matchId?: string;
  dateLabel?: string;
  timeLabel?: string;
  map?: string;
  ticketsA?: number | null;
  ticketsB?: number | null;
  factionA?: string;
  factionB?: string;
  meeting?: string;
  kills?: number;
  deaths?: number;
  res?: number;
  nok?: number;
  rpAfter?: number | null;
  rpDelta?: number | null;
};

function scoreOf(row: AnyRow): string {
  if (row.meeting && row.meeting !== "—") return String(row.meeting);
  if (row.ticketsA == null && row.ticketsB == null) return "";
  return `${row.ticketsA ?? "—"}:${row.ticketsB ?? "—"}`;
}

const rebuilding = new Map<string, Promise<void>>();

export async function replaceProfileLines(
  nick: string,
  kind: ProfileHistoryKind,
  rows: AnyRow[]
): Promise<number> {
  const clean = String(nick || "").trim();
  const key = await historyKeyFor(clean);
  if (!key) return 0;
  if (kind === "public") {
    const prev = await prisma.profileMatchLine.findMany({
      where: { kind, nickKey: key },
      select: { matchId: true, payload: true },
    });
    const byId = new Map(prev.map((line) => [line.matchId, line.payload]));
    for (const row of rows) {
      if (row.ticketsA != null && row.ticketsB != null) continue;
      const old = byId.get(row.matchId) as
        | {
            ticketsA?: number | null;
            ticketsB?: number | null;
            factionA?: string;
            factionB?: string;
          }
        | undefined;
      if (!old || old.ticketsA == null || old.ticketsB == null) continue;
      row.ticketsA = old.ticketsA;
      row.ticketsB = old.ticketsB;
      if (old.factionA && old.factionA !== "—") row.factionA = old.factionA;
      if (old.factionB && old.factionB !== "—") row.factionB = old.factionB;
    }
  }
  const data: Prisma.ProfileMatchLineCreateManyInput[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const matchId = String(row.matchId || "").trim();
    if (!matchId || seen.has(matchId)) continue;
    seen.add(matchId);
    const dateLabel = String(row.dateLabel || "");
    const timeLabel = String(row.timeLabel || "");
    data.push({
      kind,
      nickKey: key,
      nick: clean,
      matchId,
      playedOn: playedOn(dateLabel),
      timeLabel,
      sortKey: trainHistoryChronoKey({
        matchId,
        dateLabel,
        timeLabel: timeLabel || "—",
      }),
      map: String(row.map || ""),
      score: scoreOf(row),
      kills: Math.max(0, Math.round(Number(row.kills) || 0)),
      deaths: Math.max(0, Math.round(Number(row.deaths) || 0)),
      res: Math.max(0, Math.round(Number(row.res) || 0)),
      nok: Math.max(0, Math.round(Number(row.nok) || 0)),
      rpAfter:
        row.rpAfter == null || !Number.isFinite(Number(row.rpAfter))
          ? null
          : Number(row.rpAfter),
      rpDelta:
        row.rpDelta == null || !Number.isFinite(Number(row.rpDelta))
          ? null
          : Number(row.rpDelta),
      payload: JSON.parse(JSON.stringify(row)) as Prisma.InputJsonValue,
    });
  }

  // skipDuplicates: 4 PM2 workers иначе гоняются delete→create и ловят P2002.
  await prisma.$transaction(async (tx) => {
    await tx.profileMatchLine.deleteMany({ where: { kind, nickKey: key } });
    if (data.length) {
      await tx.profileMatchLine.createMany({ data, skipDuplicates: true });
    }
    await tx.profileMatchStamp.upsert({
      where: { kind_nickKey: { kind, nickKey: key } },
      create: { kind, nickKey: key },
      update: { builtAt: new Date() },
    });
  });
  return data.length;
}

async function sourceRows(nick: string, kind: ProfileHistoryKind) {
  const clean = String(nick || "").trim();
  const hit = await resolveCollision(clean);
  const steamId = hit?.steamId || null;
  const publicNick = publicRpLookupNick(clean, steamId);
  if (kind === "public") {
    const { buildPlayerPublicMatchHistory } = await import(
      "@/lib/publicMatchHistory"
    );
    return buildPlayerPublicMatchHistory(publicNick, { steamId });
  }
  if (kind === "train") {
    const { buildPlayerTrainMatchHistory } = await import("@/lib/homeTrainPwr");
    return buildPlayerTrainMatchHistory(clean, { steamId });
  }
  const { buildPlayerCwMatchHistory } = await import("@/lib/homeCwPwr");
  return buildPlayerCwMatchHistory(clean, { steamId });
}

async function sourceChangedAt(kind: ProfileHistoryKind): Promise<number | null> {
  if (kind === "public") {
    // RpMeta.updatedAt can lag behind the on-disk ladder (writer forgets to bump).
    // Prefer the ladder JSON stamp / mtime so history rebuilds after new PB1 maps.
    const stamps: number[] = [];
    try {
      const { loadPublicRpUpdatedAt } = await import("@/lib/rpDbRead");
      const stamp = await loadPublicRpUpdatedAt();
      if (stamp) {
        const t = Date.parse(stamp);
        if (Number.isFinite(t)) stamps.push(t);
      }
    } catch {
      /* ignore */
    }
    try {
      const { loadPublicRpLadder } = await import("@/lib/publicRp");
      const ladder = await loadPublicRpLadder();
      if (ladder?.updatedAt) {
        const t = Date.parse(String(ladder.updatedAt));
        if (Number.isFinite(t)) stamps.push(t);
      }
    } catch {
      /* ignore */
    }
    try {
      const { stat } = await import("fs/promises");
      const { join } = await import("path");
      const st = await stat(join(process.cwd(), "data", "public", "rp-ladder.json"));
      stamps.push(st.mtimeMs);
    } catch {
      /* ignore */
    }
    if (!stamps.length) return null;
    return Math.max(...stamps);
  }
  const stamps: number[] = [];
  const latest = await prisma.canonMatch.findFirst({
    where: { kind: kind === "train" ? "TRAIN" : "CW" },
    orderBy: { updatedAt: "desc" },
    select: { updatedAt: true },
  });
  if (latest) stamps.push(latest.updatedAt.getTime());
  // Train sync often writes calendar/players JSON without bumping CanonMatch
  // (short ids like 02-mutaha). Without mtime, stamps stay "fresh" and history
  // never picks up the new evening matches.
  if (kind === "train") {
    try {
      const { readdirSync, statSync } = await import("fs");
      const { join } = await import("path");
      const { kvLocalRoots } = await import("@/lib/kvLocal");
      for (const root of kvLocalRoots()) {
        const dir = join(root, "data", "training");
        try {
          for (const name of readdirSync(dir)) {
            if (name === "rp-ladder.json" || /^\d{4}-\d{2}\.json$/.test(name)) {
              stamps.push(statSync(join(dir, name)).mtimeMs);
            }
          }
          stamps.push(statSync(join(root, "data", "training-index.json")).mtimeMs);
          break;
        } catch {
          /* next root */
        }
      }
    } catch {
      /* ignore */
    }
  }
  if (!stamps.length) return null;
  return Math.max(...stamps);
}

/** 00:18 записан как 24:18 и висит выше дневных каток. Паблик, ТМ и КВ. */
async function clockSortStale(
  nickKey: string,
  kind: ProfileHistoryKind
): Promise<boolean> {
  const bad = await prisma.profileMatchLine.findFirst({
    where: {
      kind,
      nickKey,
      timeLabel: { startsWith: "00:" },
      sortKey: { contains: "T24:" },
    },
    select: { id: true },
  });
  return Boolean(bad);
}

async function linesAreFresh(
  nick: string,
  kind: ProfileHistoryKind
): Promise<boolean> {
  const key = await historyKeyFor(nick);
  const built = await prisma.profileMatchStamp.findUnique({
    where: { kind_nickKey: { kind, nickKey: key } },
    select: { builtAt: true },
  });
  if (!built) return false;
  if (await clockSortStale(key, kind)) return false;
  const sourceAt = await sourceChangedAt(kind);
  if (sourceAt == null || Number.isNaN(sourceAt)) return true;
  return built.builtAt.getTime() + 1000 >= sourceAt;
}

export async function ensureProfileLines(
  nick: string,
  kind: ProfileHistoryKind
): Promise<void> {
  const key = await historyKeyFor(nick);
  if (!key) return;
  const lock = `${kind}:${key}`;
  const pending = rebuilding.get(lock);
  if (pending) {
    await pending;
    return;
  }
  const job = (async () => {
    if (await linesAreFresh(nick, kind)) return;
    const rows = await sourceRows(nick, kind);
    await replaceProfileLines(nick, kind, rows);
  })().finally(() => {
    rebuilding.delete(lock);
  });
  rebuilding.set(lock, job);
  await job;
}

/** Уже записанные строки. Без пересборки истории на заходе. */
export async function readProfileLines(
  nick: string,
  kind: ProfileHistoryKind,
  page: number,
  pageSize: number
) {
  const key = await historyKeyFor(nick);
  const size = Math.min(40, Math.max(1, Math.floor(pageSize) || 15));
  const where = { kind, nickKey: key };
  const total = key ? await prisma.profileMatchLine.count({ where }) : 0;
  const pageCount = Math.max(1, Math.ceil(total / size) || 1);
  const safe = Math.min(Math.max(1, Math.floor(page) || 1), pageCount);
  const lines = key
    ? await prisma.profileMatchLine.findMany({
        where,
        orderBy: { sortKey: "desc" },
        skip: (safe - 1) * size,
        take: size,
      })
    : [];
  return {
    page: safe,
    pageSize: size,
    pageCount,
    total,
    rows: lines.map((line) => line.payload),
  };
}

const READY_TAKE = 40;

/**
 * Первая страница из таблицы. Пересборка истории не блокирует открытие профиля:
 * экран берёт уже записанные строки, свежесть догоняется после ответа.
 */
export async function loadReadyHistories(nick: string) {
  const [train, pub, cw] = await Promise.all([
    readProfileLines(nick, "train", 1, READY_TAKE),
    readProfileLines(nick, "public", 1, READY_TAKE),
    readProfileLines(nick, "cw", 1, READY_TAKE),
  ]);
  refreshProfileLinesBackground(nick);
  return {
    trainHistory: train.rows,
    publicHistory: pub.rows,
    cwHistory: cw.rows,
    trainTotal: train.total,
    publicTotal: pub.total,
    cwTotal: cw.total,
  };
}

/** Свежесть догоняем после ответа, экран на это не ждёт. */
export function refreshProfileLinesBackground(nick: string) {
  const clean = String(nick || "").trim();
  if (!clean) return;
  for (const kind of ["train", "public", "cw"] as const) {
    void ensureProfileLines(clean, kind).catch(() => {});
  }
}

async function attachPublicScores<T extends { rows: unknown[] }>(
  kind: ProfileHistoryKind,
  ready: T
): Promise<T> {
  if (kind !== "public" || ready.rows.length === 0) return ready;
  const need: string[] = [];
  for (const row of ready.rows) {
    if (!row || typeof row !== "object") continue;
    const item = row as {
      matchId?: string;
      ticketsA?: number | null;
      ticketsB?: number | null;
    };
    if (item.ticketsA != null && item.ticketsB != null) continue;
    const id = String(item.matchId || "").trim();
    if (id) need.push(id);
  }
  if (!need.length) return ready;
  const found = await prisma.rpScoredMatch
    .findMany({
      where: { scope: "PUBLIC", matchKey: { in: need } },
      select: { matchKey: true, rawJson: true },
    })
    .catch(() => []);
  const byId = new Map<string, { a: number; b: number }>();
  for (const row of found) {
    const raw = row.rawJson as { score1?: unknown; score2?: unknown } | null;
    const a = Number(raw?.score1);
    const b = Number(raw?.score2);
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    byId.set(row.matchKey, { a, b });
  }
  if (!byId.size) return ready;
  return {
    ...ready,
    rows: ready.rows.map((row) => {
      if (!row || typeof row !== "object") return row;
      const item = row as {
        matchId?: string;
        ticketsA?: number | null;
        ticketsB?: number | null;
      };
      if (item.ticketsA != null && item.ticketsB != null) return row;
      const hit = byId.get(String(item.matchId || ""));
      if (!hit) return row;
      return { ...item, ticketsA: hit.a, ticketsB: hit.b };
    }),
  };
}

export async function pageProfileLines(
  nick: string,
  kind: ProfileHistoryKind,
  page: number,
  pageSize: number
) {
  await ensureProfileLines(nick, kind);
  const ready = await attachPublicScores(
    kind,
    await readProfileLines(nick, kind, page, pageSize)
  );
  if (kind === "public" && ready.page === 1 && ready.rows.length) {
    const { loadPublicRpOneFromDb } = await import("@/lib/rpDbRead");
    const hit = await resolveCollision(nick);
    const live = await loadPublicRpOneFromDb(
      publicRpLookupNick(nick, hit?.steamId)
    ).catch(() => null);
    const first = ready.rows[0];
    if (live && Number.isFinite(live.rp) && first && typeof first === "object") {
      const official = Math.round(live.rp);
      const row = { ...(first as Record<string, unknown>) };
      const shown =
        row.rpAfter == null || !Number.isFinite(Number(row.rpAfter))
          ? null
          : Math.round(Number(row.rpAfter));
      // Never invent a +1000 jump on a stale top row: only align when close.
      if (shown == null || Math.abs(shown - official) <= 5) {
        row.rpAfter = official;
        row.pwrAfter = official;
      }
      row.rankLabel = live.rankLabel;
      row.rankKey = live.rankKey;
      ready.rows = [row, ...ready.rows.slice(1)];
    }
  }
  return ready;
}

/** Public ladder only. Train and clan rows are built when that profile opens. */
export async function rebuildAllPublicLines(): Promise<number> {
  const { loadPublicRpLadder } = await import("@/lib/publicRp");
  const ladder = await loadPublicRpLadder();
  const nicks = (ladder?.leaderboard || []).map((r) => r.nick).filter(Boolean);
  let n = 0;
  for (const nick of nicks) {
    const rows = await sourceRows(nick, "public");
    await replaceProfileLines(nick, "public", rows);
    n += 1;
  }
  return n;
}
