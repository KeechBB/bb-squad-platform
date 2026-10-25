/**
 * Phase 4: public attendance publish at MSK hour boundaries (:00).
 * Admin continues to read live Postgres; site reads the frozen snapshot.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  buildAttendanceStreakBoard,
  emptyAttendanceStreakBoard,
  type AttendanceStreakBoard,
} from "@/lib/attendanceStreaks";
import { mskParts } from "@/lib/squadSessions";

export const ATTENDANCE_PUBLISH_REL = "attendance-published.json";

export type AttendancePublishedEnvelope = {
  /** ISO time when this snapshot was built */
  publishedAt: string;
  /** MSK hour bucket: YYYY-MM-DDTHH (Europe/Moscow) */
  hourKey: string;
  board: AttendanceStreakBoard;
};

export function attendanceHourKeyMsk(now = new Date()): string {
  const p = mskParts(now);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.day).padStart(2, "0")}T${String(p.h).padStart(2, "0")}`;
}

/**
 * Start of the current MSK hour as UTC.
 * Public site must not show session activity at/after this instant until the next :00 publish.
 */
export function attendancePublishedUntilUtc(now = new Date()): Date {
  const p = mskParts(now);
  return new Date(
    Date.UTC(p.y, p.m - 1, p.day, p.h, 0, 0, 0) - 3 * 60 * 60 * 1000
  );
}

/** Clip sessions so presence/minutes stop at the last published hour boundary. */
export function clipSessionsToPublishedUntil<
  T extends { joinedAt: Date; leftAt: Date | null },
>(sessions: T[], until: Date): T[] {
  const out: T[] = [];
  for (const s of sessions) {
    if (s.joinedAt >= until) continue;
    const leftAt =
      s.leftAt == null || s.leftAt > until ? until : s.leftAt;
    out.push({ ...s, leftAt });
  }
  return out;
}

function publishFile(): string {
  return path.join(process.cwd(), "data", "cache", ATTENDANCE_PUBLISH_REL);
}

export async function readAttendancePublished(): Promise<AttendancePublishedEnvelope | null> {
  try {
    const raw = await fs.readFile(publishFile(), "utf8");
    const env = JSON.parse(raw) as AttendancePublishedEnvelope;
    if (!env?.board || !env.publishedAt || !env.hourKey) return null;
    return env;
  } catch {
    return null;
  }
}

export async function writeAttendancePublished(
  board: AttendanceStreakBoard,
  now = new Date()
): Promise<AttendancePublishedEnvelope> {
  const env: AttendancePublishedEnvelope = {
    publishedAt: now.toISOString(),
    hourKey: attendanceHourKeyMsk(now),
    board: {
      ...board,
      updatedAt: now.toISOString(),
    },
  };
  const file = publishFile();
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(env), "utf8");
  await fs.rename(tmp, file);
  return env;
}

/** Rebuild from DB and freeze for the site (cron :00 MSK / bootstrap). */
export async function publishAttendanceBoard(
  now = new Date()
): Promise<AttendancePublishedEnvelope> {
  const board = await buildAttendanceStreakBoard(now);
  return writeAttendancePublished(board, now);
}

/**
 * Site read: frozen snapshot only. If missing or from a previous day without
 * bootstrap, publish once so the page is not empty.
 */
export async function getPublishedAttendanceBoard(): Promise<AttendanceStreakBoard> {
  const hit = await readAttendancePublished();
  if (hit?.board) return hit.board;
  try {
    const env = await publishAttendanceBoard();
    return env.board;
  } catch {
    return emptyAttendanceStreakBoard();
  }
}
