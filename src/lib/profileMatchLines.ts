/**
 * Flat profile history. One row per player match, written when the history
 * is built, read with LIMIT/OFFSET. The page does not assemble the model.
 */
import { prisma } from "@/lib/prisma";
import { trainHistoryChronoKey } from "@/lib/homeTrainPwr";
import type { Prisma } from "@prisma/client";

export type ProfileHistoryKind = "public" | "train" | "cw";

const KINDS = new Set<ProfileHistoryKind>(["public", "train", "cw"]);

export function isProfileHistoryKind(v: string): v is ProfileHistoryKind {
  return KINDS.has(v as ProfileHistoryKind);
}

function nickKey(n: string) {
  return String(n || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
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
  const key = nickKey(nick);
  const clean = String(nick || "").trim();
  if (!key) return 0;
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

  await prisma.$transaction([
    prisma.profileMatchLine.deleteMany({ where: { kind, nickKey: key } }),
    ...(data.length
      ? [prisma.profileMatchLine.createMany({ data })]
      : []),
    prisma.profileMatchStamp.upsert({
      where: { kind_nickKey: { kind, nickKey: key } },
      create: { kind, nickKey: key },
      update: { builtAt: new Date() },
    }),
  ]);
  return data.length;
}

async function sourceRows(nick: string, kind: ProfileHistoryKind) {
  if (kind === "public") {
    const { buildPlayerPublicMatchHistory } = await import(
      "@/lib/publicMatchHistory"
    );
    return buildPlayerPublicMatchHistory(nick);
  }
  if (kind === "train") {
    const { buildPlayerTrainMatchHistory } = await import("@/lib/homeTrainPwr");
    return buildPlayerTrainMatchHistory(nick);
  }
  const { buildPlayerCwMatchHistory } = await import("@/lib/homeCwPwr");
  return buildPlayerCwMatchHistory(nick);
}

async function sourceChangedAt(kind: ProfileHistoryKind): Promise<number | null> {
  if (kind === "public") {
    const { loadPublicRpUpdatedAt } = await import("@/lib/rpDbRead");
    const stamp = await loadPublicRpUpdatedAt();
    return stamp ? Date.parse(stamp) : null;
  }
  const latest = await prisma.canonMatch.findFirst({
    where: { kind: kind === "train" ? "TRAIN" : "CW" },
    orderBy: { updatedAt: "desc" },
    select: { updatedAt: true },
  });
  return latest ? latest.updatedAt.getTime() : null;
}

async function linesAreFresh(
  nick: string,
  kind: ProfileHistoryKind
): Promise<boolean> {
  const key = nickKey(nick);
  const built = await prisma.profileMatchStamp.findUnique({
    where: { kind_nickKey: { kind, nickKey: key } },
    select: { builtAt: true },
  });
  if (!built) return false;
  const sourceAt = await sourceChangedAt(kind);
  if (sourceAt == null || Number.isNaN(sourceAt)) return true;
  return built.builtAt.getTime() + 1000 >= sourceAt;
}

export async function ensureProfileLines(
  nick: string,
  kind: ProfileHistoryKind
): Promise<void> {
  const key = nickKey(nick);
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
  const key = nickKey(nick);
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

/** Первая страница, которая уже лежит в таблице. Её рисуем сразу. */
export async function loadReadyHistories(nick: string) {
  const [train, pub, cw] = await Promise.all([
    readProfileLines(nick, "train", 1, READY_TAKE),
    readProfileLines(nick, "public", 1, READY_TAKE),
    readProfileLines(nick, "cw", 1, READY_TAKE),
  ]);
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

export async function pageProfileLines(
  nick: string,
  kind: ProfileHistoryKind,
  page: number,
  pageSize: number
) {
  const ready = await readProfileLines(nick, kind, page, pageSize);
  if (ready.total > 0) return ready;
  const key = nickKey(nick);
  if (!key) return ready;
  const stamp = await prisma.profileMatchStamp.findUnique({
    where: { kind_nickKey: { kind, nickKey: key } },
    select: { id: true },
  });
  if (stamp) return ready;
  await ensureProfileLines(nick, kind);
  return readProfileLines(nick, kind, page, pageSize);
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
