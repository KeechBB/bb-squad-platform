/**
 * Алерты в Telegram-бот клана: участник BB без явки >30 дней подряд,
 * не в резерве → расследование. Повтор через 10 дней с точным числом дней.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { sendBbAlert } from "@/lib/bbAlerts";
import {
  addDaysYmd,
  attendanceAnchorYmd,
  missStreakEndingAt,
  lastPresentYmd,
} from "@/lib/attendanceStreaks";
import {
  ATTENDANCE_CANON_START_YMD,
  attendanceCanonStartUtc,
  presentTrainingDaysFromSessions,
  trainingDayYmd,
} from "@/lib/squadSessions";
import { TRAINING_SERVER_KEYS } from "@/lib/squadServers";
import {
  findBlackberryClanIds,
  reserveTrainingDaysFromStints,
  userInReserve,
} from "@/lib/reserve";

export const INACTIVE_ALERT_MISS_DAYS = 30;
export const INACTIVE_ALERT_REPEAT_DAYS = 10;
export const INACTIVE_ALERT_STATE_REL = "inactive-clan-alerts.json";

export type InactiveAlertStateRow = {
  nick: string;
  steamId: string;
  firstAlertAt: string;
  lastAlertAt: string;
  lastMissDays: number;
  alertCount: number;
};

export type InactiveAlertStateFile = {
  updatedAt: string;
  byUserId: Record<string, InactiveAlertStateRow>;
};

export type InactiveCandidate = {
  userId: string;
  nick: string;
  steamId: string;
  missDays: number;
  lastPresent: string | null;
  joinedYmd: string;
};

export type InactiveAlertRunReport = {
  ok: boolean;
  dryRun: boolean;
  anchorYmd: string;
  candidates: number;
  sent: number;
  skippedFresh: number;
  skippedCooldown: number;
  cleared: number;
  errors: number;
  items: Array<{
    nick: string;
    steamId: string;
    missDays: number;
    kind: "first" | "repeat" | "dry" | "cooldown";
    sent: boolean;
  }>;
};

function statePath(): string {
  return path.join(process.cwd(), "data", "cache", INACTIVE_ALERT_STATE_REL);
}

async function readState(): Promise<InactiveAlertStateFile> {
  try {
    const raw = await fs.readFile(statePath(), "utf8");
    const parsed = JSON.parse(raw) as InactiveAlertStateFile;
    if (!parsed || typeof parsed !== "object") {
      return { updatedAt: new Date().toISOString(), byUserId: {} };
    }
    return {
      updatedAt: parsed.updatedAt || new Date().toISOString(),
      byUserId: parsed.byUserId && typeof parsed.byUserId === "object" ? parsed.byUserId : {},
    };
  } catch {
    return { updatedAt: new Date().toISOString(), byUserId: {} };
  }
}

async function writeState(state: InactiveAlertStateFile): Promise<void> {
  const file = statePath();
  await fs.mkdir(path.dirname(file), { recursive: true });
  const next = { ...state, updatedAt: new Date().toISOString() };
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(next, null, 2), "utf8");
  await fs.rename(tmp, file);
}

function daysBetweenUtc(isoA: string, now = new Date()): number {
  const a = Date.parse(isoA);
  if (!Number.isFinite(a)) return 9999;
  return Math.floor((now.getTime() - a) / 86_400_000);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Основной BlackBerry, без Junior. */
export async function findMainBlackberryClanIds(): Promise<string[]> {
  const ids = await findBlackberryClanIds();
  if (!ids.length) return [];
  const clans = await prisma.clan.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, tag: true },
  });
  return clans
    .filter((c) => !/junior/i.test(`${c.name || ""} ${c.tag || ""}`))
    .map((c) => c.id);
}

function formatMissPhrase(missDays: number, exact: boolean): string {
  if (!exact) return "не проявлял активность больше 30 дней";
  const n = Math.max(0, Math.floor(missDays));
  const mod10 = n % 10;
  const mod100 = n % 100;
  let unit = "дней";
  if (mod10 === 1 && mod100 !== 11) unit = "день";
  else if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) unit = "дня";
  return `не проявлял активность ${n} ${unit} подряд`;
}

export function buildInactiveAlertText(opts: {
  nick: string;
  steamId: string;
  missDays: number;
  repeat: boolean;
}): string {
  const title = opts.repeat
    ? "🔁 Повторный алерт: нет активности"
    : "⚠️ Нет активности больше 30 дней";
  const stamp = new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date()) + " МСК";

  return [
    title,
    `📅 ${stamp}`,
    "🏷 тип: явка · расследование",
    "———",
    `• ник: ${opts.nick}`,
    `• Steam: ${opts.steamId || "—"}`,
    `• отсутствие: ${formatMissPhrase(opts.missDays, opts.repeat)}`,
    "• статус: в резерве не состоит",
    "• требование: провести расследование, что с данным игроком!",
  ].join("\n");
}

/** Кандидаты: BB (не Junior), не резерв, missStreak > 30 с даты вступления. */
export async function listInactiveClanCandidates(
  now = new Date()
): Promise<{ anchorYmd: string; candidates: InactiveCandidate[] }> {
  const anchorYmd = attendanceAnchorYmd(now);
  const clanIds = await findMainBlackberryClanIds();
  if (!clanIds.length) return { anchorYmd, candidates: [] };

  const members = await prisma.clanMember.findMany({
    where: { clanId: { in: clanIds } },
    select: {
      userId: true,
      role: true,
      joinedAt: true,
      user: {
        select: {
          id: true,
          nick: true,
          steamId: true,
          reserveUntil: true,
          profileComplete: true,
        },
      },
    },
  });

  const active = members.filter((m) => {
    const u = m.user;
    if (!u?.profileComplete || !u.nick) return false;
    if (m.role === "RESERVE") return false;
    if (userInReserve(u)) return false;
    return true;
  });
  const userIds = active.map((m) => m.userId);
  if (!userIds.length) return { anchorYmd, candidates: [] };

  const [sessions, stints] = await Promise.all([
    prisma.squadServerSession.findMany({
      where: {
        serverKey: { in: [...TRAINING_SERVER_KEYS] },
        joinedAt: { gte: attendanceCanonStartUtc() },
        userId: { in: userIds },
      },
      orderBy: { joinedAt: "asc" },
      select: {
        userId: true,
        joinedAt: true,
        leftAt: true,
        serverKey: true,
      },
    }),
    prisma.reserveStint.findMany({
      where: { userId: { in: userIds } },
      select: {
        userId: true,
        enteredAt: true,
        untilAt: true,
        exitedAt: true,
      },
    }),
  ]);

  const byUser = new Map<
    string,
    Array<{ joinedAt: Date; leftAt: Date | null; serverKey: string }>
  >();
  for (const s of sessions) {
    if (!s.userId) continue;
    if (!byUser.has(s.userId)) byUser.set(s.userId, []);
    byUser.get(s.userId)!.push({
      joinedAt: s.joinedAt,
      leftAt: s.leftAt,
      serverKey: s.serverKey,
    });
  }

  const reserveByUser = new Map<string, typeof stints>();
  for (const s of stints) {
    if (!reserveByUser.has(s.userId)) reserveByUser.set(s.userId, []);
    reserveByUser.get(s.userId)!.push(s);
  }

  const candidates: InactiveCandidate[] = [];
  for (const m of active) {
    const u = m.user!;
    const joinedYmd = trainingDayYmd(m.joinedAt);
    const fromYmd =
      joinedYmd > ATTENDANCE_CANON_START_YMD
        ? joinedYmd
        : ATTENDANCE_CANON_START_YMD;
    if (anchorYmd < fromYmd) continue;

    const present = presentTrainingDaysFromSessions(byUser.get(u.id) || [], now);
    const reserve = new Set(
      reserveTrainingDaysFromStints(reserveByUser.get(u.id) || [], anchorYmd)
    );
    const missDays = missStreakEndingAt(present, anchorYmd, fromYmd, reserve);
    if (missDays <= INACTIVE_ALERT_MISS_DAYS) continue;

    candidates.push({
      userId: u.id,
      nick: u.nick || "—",
      steamId: (u.steamId || "").trim(),
      missDays,
      lastPresent: lastPresentYmd(present, anchorYmd, fromYmd),
      joinedYmd,
    });
  }

  candidates.sort((a, b) => b.missDays - a.missDays || a.nick.localeCompare(b.nick, "ru"));
  return { anchorYmd, candidates };
}

export async function runInactiveClanAlerts(opts?: {
  dryRun?: boolean;
  /** Пауза между Telegram-сообщениями */
  delayMs?: number;
  now?: Date;
}): Promise<InactiveAlertRunReport> {
  const dryRun = Boolean(opts?.dryRun);
  const delayMs = Math.max(0, opts?.delayMs ?? 700);
  const now = opts?.now || new Date();
  const { anchorYmd, candidates } = await listInactiveClanCandidates(now);
  const state = await readState();
  const activeIds = new Set(candidates.map((c) => c.userId));

  let cleared = 0;
  for (const id of Object.keys(state.byUserId)) {
    if (!activeIds.has(id)) {
      delete state.byUserId[id];
      cleared += 1;
    }
  }

  const report: InactiveAlertRunReport = {
    ok: true,
    dryRun,
    anchorYmd,
    candidates: candidates.length,
    sent: 0,
    skippedFresh: 0,
    skippedCooldown: 0,
    cleared,
    errors: 0,
    items: [],
  };

  for (const c of candidates) {
    const prev = state.byUserId[c.userId];
    const isRepeat = Boolean(prev?.lastAlertAt);
    if (isRepeat) {
      const since = daysBetweenUtc(prev!.lastAlertAt, now);
      if (since < INACTIVE_ALERT_REPEAT_DAYS) {
        report.skippedCooldown += 1;
        report.items.push({
          nick: c.nick,
          steamId: c.steamId,
          missDays: c.missDays,
          kind: "cooldown",
          sent: false,
        });
        continue;
      }
    }

    const kind = isRepeat ? "repeat" : "first";
    const text = buildInactiveAlertText({
      nick: c.nick,
      steamId: c.steamId,
      missDays: c.missDays,
      repeat: isRepeat,
    });

    if (dryRun) {
      report.items.push({
        nick: c.nick,
        steamId: c.steamId,
        missDays: c.missDays,
        kind: "dry",
        sent: false,
      });
      continue;
    }

    const ok = await sendBbAlert(text);
    if (!ok) {
      report.errors += 1;
      report.items.push({
        nick: c.nick,
        steamId: c.steamId,
        missDays: c.missDays,
        kind,
        sent: false,
      });
      continue;
    }

    const iso = now.toISOString();
    state.byUserId[c.userId] = {
      nick: c.nick,
      steamId: c.steamId,
      firstAlertAt: prev?.firstAlertAt || iso,
      lastAlertAt: iso,
      lastMissDays: c.missDays,
      alertCount: (prev?.alertCount || 0) + 1,
    };
    report.sent += 1;
    report.items.push({
      nick: c.nick,
      steamId: c.steamId,
      missDays: c.missDays,
      kind,
      sent: true,
    });
    if (delayMs > 0) await sleep(delayMs);
  }

  if (!dryRun) await writeState(state);
  return report;
}
