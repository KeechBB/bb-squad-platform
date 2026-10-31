/**
 * Ближайшие КВ Main/Junior и отметки «буду».
 * Список виден только участникам клана BlackBerry.
 * Отметки лежат в таблице CwReady, не в файле. Снятие галочки строку не удаляет.
 *
 * Перенос слота: в календаре status=move + movedTo=<новый id> —
 * главная берёт только upcoming, а отметки «буду» сами переезжают на новый id.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { findBlackberryClanIds } from "@/lib/reserve";
import { isBbHostMatch } from "@/lib/kvStats";
import { loadKvJsonCached } from "@/lib/kvLocal";

export type CwStack = "Main" | "Junior";

export type CwAnnounce = {
  id: string;
  stack: CwStack;
  dateLabel: string;
  timeMsk: string;
  opp: string;
  map: string;
  size: string;
  server: string;
  rules: string;
};

type ReadyFile = Record<string, { userId?: string; nick?: string; at?: string }[]>;

const LEGACY_READY_PATH = path.join(process.cwd(), "data", "cw-ready.json");

export async function viewerIsBlackberry(
  userId: string | null | undefined
): Promise<boolean> {
  const id = String(userId || "").trim();
  if (!id) return false;
  const clanIds = await findBlackberryClanIds();
  if (!clanIds.length) return false;
  const n = await prisma.clanMember.count({
    where: { userId: id, clanId: { in: clanIds } },
  });
  return n > 0;
}

function stackOf(raw: unknown): CwStack | null {
  const s = String(raw || "")
    .trim()
    .toLowerCase();
  if (s === "main" || s === "bb main") return "Main";
  if (s === "junior" || s === "bb junior") return "Junior";
  return null;
}

function startUtcMs(row: {
  year?: number;
  month?: number;
  day?: number;
  timeMsk?: string;
}): number | null {
  const y = Number(row.year);
  const mo = Number(row.month);
  const d = Number(row.day);
  if (!y || !mo || !d) return null;
  const hm = /^(\d{1,2}):(\d{2})$/.exec(String(row.timeMsk || "").trim());
  const hh = hm ? Number(hm[1]) : 23;
  const mm = hm ? Number(hm[2]) : 59;
  return Date.UTC(y, mo - 1, d, hh - 3, mm, 0);
}

function cleanText(raw: unknown, fallback = ""): string {
  const s = String(raw || "")
    .replace(/\s+/g, " ")
    .trim();
  return s || fallback;
}

type DiskMatch = {
  id?: string;
  day?: number;
  timeMsk?: string;
  opp?: string;
  map?: string;
  size?: string;
  server?: string;
  rules?: string;
  stack?: string;
  status?: string;
  /** Новый id слота после переноса (главная / CwReady). */
  movedTo?: string;
  note?: string;
  clan?: string;
  r1?: string;
  r2?: string;
};

type MonthDisk = {
  year?: number;
  month?: string | number;
  matches?: DiskMatch[];
};

/** Раз в 30с на воркер — подтянуть movedTo → CwReady. */
let moveSyncAt = 0;
let moveSyncInflight: Promise<number> | null = null;

function parseMovedToDayMonth(note: string): { day: number; month: number } | null {
  const m = /перенос\s*→\s*(\d{1,2})\.(\d{1,2})/i.exec(note);
  if (!m) return null;
  return { day: Number(m[1]), month: Number(m[2]) };
}

async function loadCalendarMoveHops(): Promise<Map<string, string>> {
  const index = await loadKvJsonCached<{
    months?: { url?: string; year?: number; month?: number }[];
  }>("data/index.json");
  const hops = new Map<string, string>();
  /** key: `MM-DD|OPP|Stack` → upcoming match id (год не важен для поиска цели переноса). */
  const upcomingByDayOppStack = new Map<string, string>();
  const moveRows: {
    id: string;
    opp: string;
    stack: CwStack;
    note: string;
    movedTo: string;
  }[] = [];

  for (const meta of index?.months || []) {
    if (!meta.url) continue;
    const data = await loadKvJsonCached<MonthDisk>(meta.url);
    if (!data) continue;
    const month =
      Number(meta.month) ||
      Number(String(data.month || "").slice(5, 7)) ||
      Number(data.month) ||
      0;
    for (const match of data.matches || []) {
      const id = cleanText(match.id);
      if (!id) continue;
      const stack = stackOf(match.stack);
      const opp = cleanText(match.opp).toUpperCase();
      const day = Number(match.day) || 0;
      const status = String(match.status || "");
      if (status === "upcoming" && stack && opp && day && month) {
        upcomingByDayOppStack.set(
          `${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}|${opp}|${stack}`,
          id
        );
      }
      if (status === "move") {
        moveRows.push({
          id,
          opp,
          stack: stack || "Main",
          note: String(match.note || ""),
          movedTo: cleanText(match.movedTo),
        });
      }
    }
  }

  for (const row of moveRows) {
    if (row.movedTo && row.movedTo !== row.id) {
      hops.set(row.id, row.movedTo);
      continue;
    }
    const parsed = parseMovedToDayMonth(row.note);
    if (!parsed || !row.opp) continue;
    const key = `${String(parsed.month).padStart(2, "0")}-${String(parsed.day).padStart(2, "0")}|${row.opp}|${row.stack}`;
    const target = upcomingByDayOppStack.get(key);
    if (target && target !== row.id) hops.set(row.id, target);
  }

  return hops;
}

/**
 * При переносе слота (status=move → movedTo) обнуляем «буду» на СТАРОМ id.
 * На новый слот отметки не копируем — состав подтверждает заново.
 */
export async function applyCwCalendarMoves(): Promise<number> {
  const hops = await loadCalendarMoveHops();
  if (!hops.size) return 0;
  const fromIds = [...hops.keys()];
  if (!fromIds.length) return 0;
  const res = await prisma.cwReady.updateMany({
    where: { matchId: { in: fromIds }, going: true },
    data: { going: false, withdrawnAt: new Date() },
  });
  return res.count;
}

async function ensureCwReadyMovesSynced(): Promise<void> {
  const now = Date.now();
  if (now - moveSyncAt < 30_000) return;
  if (moveSyncInflight) {
    await moveSyncInflight;
    return;
  }
  moveSyncAt = now;
  moveSyncInflight = (async () => {
    try {
      return await applyCwCalendarMoves();
    } catch {
      return 0;
    } finally {
      moveSyncInflight = null;
    }
  })();
  await moveSyncInflight;
}

function ticketPair(raw: unknown): boolean {
  return /^\d+\s*[:\-–—]\s*\d+$/.test(String(raw || "").trim());
}

/** Итог встречи уже на сайте: статус закрыт или залиты оба раунда. */
function meetingClosed(match: DiskMatch): boolean {
  const status = String(match.status || "");
  if (status === "win" || status === "lose" || status === "draw") return true;
  return ticketPair(match.r1) && ticketPair(match.r2);
}

async function upcomingBb(): Promise<
  (CwAnnounce & { start: number })[]
> {
  await ensureCwReadyMovesSynced();
  const moveHops = await loadCalendarMoveHops();
  const movedAway = new Set(moveHops.keys());
  const index = await loadKvJsonCached<{
    months?: { url?: string; year?: number; month?: number }[];
  }>("data/index.json");
  const out: (CwAnnounce & { start: number })[] = [];
  for (const meta of index?.months || []) {
    if (!meta.url) continue;
    const data = await loadKvJsonCached<MonthDisk>(meta.url);
    if (!data) continue;
    const year = Number(meta.year) || Number(data.year) || 0;
    const month =
      Number(meta.month) ||
      Number(String(data.month || "").slice(5, 7)) ||
      Number(data.month) ||
      0;
    for (const match of data.matches || []) {
      const status = String(match.status || "");
      if (status === "cancel" || status === "move" || meetingClosed(match)) {
        continue;
      }
      if (status !== "upcoming") continue;
      if (!isBbHostMatch(match)) continue;
      const stack = stackOf(match.stack);
      if (!stack) continue;
      const id = cleanText(match.id);
      if (!id) continue;
      // Даже если canon снова проставил upcoming — слот-источник переноса не показываем.
      if (movedAway.has(id) || cleanText(match.movedTo)) continue;
      const start = startUtcMs({
        year,
        month,
        day: match.day,
        timeMsk: match.timeMsk,
      });
      if (start == null) continue;
      const day = Number(match.day) || 0;
      out.push({
        id,
        stack,
        start,
        dateLabel: `${String(day).padStart(2, "0")}.${String(month).padStart(2, "0")}`,
        timeMsk: cleanText(match.timeMsk, "—"),
        opp: cleanText(match.opp, "—"),
        map: cleanText(match.map, "—"),
        size: cleanText(match.size, "—"),
        server: cleanText(match.server, "—"),
        rules: cleanText(match.rules, "—"),
      });
    }
  }
  out.sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
  return out;
}

function asAnnounce(row: (CwAnnounce & { start: number }) | undefined): CwAnnounce | null {
  if (!row) return null;
  return {
    id: row.id,
    stack: row.stack,
    dateLabel: row.dateLabel,
    timeMsk: row.timeMsk,
    opp: row.opp,
    map: row.map,
    size: row.size,
    server: row.server,
    rules: row.rules,
  };
}

/** Все ближайшие КВ BlackBerry в расписании, не только ближайшая на стак. */
export async function upcomingCwMeetings(): Promise<
  (CwAnnounce & { start: number })[]
> {
  return upcomingBb();
}

export async function cwReadyState(
  matchId: string,
  userId: string
): Promise<{ ready: string[]; going: boolean; open: boolean } | null> {
  const id = cleanText(matchId);
  if (!id) return null;
  const [ready, going, upcoming] = await Promise.all([
    nicksGoing(id),
    viewerGoing(id, userId),
    upcomingBb(),
  ]);
  return { ready, going, open: upcoming.some((m) => m.id === id) };
}

export async function nextCwAnnounces(): Promise<{
  main: CwAnnounce | null;
  junior: CwAnnounce | null;
}> {
  const rows = await upcomingBb();
  return {
    main: asAnnounce(rows.find((r) => r.stack === "Main")),
    junior: asAnnounce(rows.find((r) => r.stack === "Junior")),
  };
}

async function nicksGoing(matchId: string): Promise<string[]> {
  const rows = await prisma.cwReady.findMany({
    where: { matchId, going: true },
    orderBy: { signedAt: "asc" },
    select: { nick: true },
  });
  return rows.map((r) => r.nick).filter(Boolean);
}

export async function readyNicks(matchId: string): Promise<string[]> {
  return nicksGoing(matchId);
}

export async function viewerGoing(
  matchId: string,
  userId: string
): Promise<boolean> {
  const row = await prisma.cwReady.findUnique({
    where: { matchId_userId: { matchId, userId } },
    select: { going: true },
  });
  return Boolean(row?.going);
}

export async function toggleReady(
  matchId: string,
  userId: string,
  nick: string
): Promise<{ going: boolean; ready: string[] } | null> {
  const id = cleanText(matchId);
  const upcoming = await upcomingBb();
  const slot = upcoming.find((m) => m.id === id);
  if (!slot) return null;
  const safeNick = cleanText(nick, "без ника").slice(0, 32);
  const snap = {
    stack: slot.stack,
    opp: slot.opp,
    dateLabel: slot.dateLabel,
    timeMsk: slot.timeMsk,
    map: slot.map,
    nick: safeNick,
  };
  await prisma.$transaction(async (tx) => {
    const row = await tx.cwReady.findUnique({
      where: { matchId_userId: { matchId: id, userId } },
    });
    if (!row) {
      await tx.cwReady.create({
        data: { matchId: id, userId, going: true, ...snap },
      });
      return;
    }
    if (row.going) {
      await tx.cwReady.update({
        where: { id: row.id },
        data: { going: false, withdrawnAt: new Date(), nick: safeNick },
      });
      return;
    }
    await tx.cwReady.update({
      where: { id: row.id },
      data: { going: true, withdrawnAt: null, ...snap },
    });
  });
  const going = await viewerGoing(id, userId);
  return { going, ready: await nicksGoing(id) };
}

/** Один раз переносит data/cw-ready.json в таблицу. Уже существующие строки не трогает. */
export async function importLegacyReadyFile(): Promise<{
  fileRows: number;
  inserted: number;
  skipped: number;
}> {
  let data: ReadyFile = {};
  try {
    const raw = await fs.readFile(LEGACY_READY_PATH, "utf8");
    const parsed = JSON.parse(raw) as ReadyFile;
    if (parsed && typeof parsed === "object") data = parsed;
  } catch {
    return { fileRows: 0, inserted: 0, skipped: 0 };
  }
  const slots = await upcomingBb();
  const byId = new Map(slots.map((s) => [s.id, s]));
  let fileRows = 0;
  let inserted = 0;
  let skipped = 0;
  for (const [matchId, rows] of Object.entries(data)) {
    const slot = byId.get(matchId);
    for (const row of rows || []) {
      const userId = cleanText(row.userId);
      const nick = cleanText(row.nick, "без ника").slice(0, 32);
      if (!userId || !nick) continue;
      fileRows += 1;
      const signedAt = row.at ? new Date(row.at) : new Date();
      const when = Number.isNaN(signedAt.getTime()) ? new Date() : signedAt;
      try {
        await prisma.cwReady.create({
          data: {
            matchId,
            userId,
            nick,
            going: true,
            signedAt: when,
            createdAt: when,
            stack: slot?.stack || "",
            opp: slot?.opp || "",
            dateLabel: slot?.dateLabel || "",
            timeMsk: slot?.timeMsk || "",
            map: slot?.map || "",
          },
        });
        inserted += 1;
      } catch {
        skipped += 1;
      }
    }
  }
  return { fileRows, inserted, skipped };
}
