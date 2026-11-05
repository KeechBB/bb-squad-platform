import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isBuiltinSuperAdmin } from "@/lib/admin";
import { loadFactionView } from "@/lib/factions";
import { mskParts } from "@/lib/squadSessions";
import { TRAINING_SERVER_KEYS } from "@/lib/squadServers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string }> };

const WEEKDAY = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];

function ymdFromParts(y: number, m: number, day: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function addDays(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return ymdFromParts(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

function weekdayOf(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return WEEKDAY[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] || "";
}

function dateLabel(ymd: string): string {
  return `${ymd.slice(8, 10)}.${ymd.slice(5, 7)}`;
}

function hmMsk(d: Date): string {
  const p = mskParts(d);
  const h = p.h === 24 ? 0 : p.h;
  return `${String(h).padStart(2, "0")}:${String(p.min).padStart(2, "0")}`;
}

function ymdMsk(d: Date): string {
  const p = mskParts(d);
  return ymdFromParts(p.y, p.m, p.day);
}

/** Час:минута календарного дня по Москве. */
function mskAt(ymd: string, hour: number, minute = 0): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, hour, minute, 0) - 3 * 3600 * 1000);
}

type Visit = { joinedAt: Date; leftAt: Date | null };

/** Один заход: первое появление в окне и последний выход, после которого возврата не было. */
function eveningSpan(visits: Visit[], start: Date, end: Date, now: Date): string {
  const hit = visits.filter((v) => v.joinedAt < end && (v.leftAt == null || v.leftAt > start));
  if (!hit.length) return "—";
  const arrivalMs = Math.max(Math.min(...hit.map((v) => v.joinedAt.getTime())), start.getTime());
  let bestMs = -1;
  let open = false;
  for (const v of hit) {
    const still = v.leftAt == null;
    const ms = still ? now.getTime() : v.leftAt!.getTime();
    if (ms > bestMs || (ms === bestMs && still)) {
      bestMs = ms;
      open = still;
    }
  }
  const out = open && now < end ? "…" : hmMsk(new Date(Math.min(bestMs, end.getTime())));
  return `${hmMsk(new Date(arrivalMs))}–${out}`;
}

export async function GET(_req: Request, ctx: Ctx) {
  const session = await getServerSession(authOptions);
  const { slug } = await ctx.params;
  const loaded = await loadFactionView(decodeURIComponent(slug), session?.user?.steamId ?? null);
  if (loaded.error || !loaded.view) {
    return NextResponse.json({ error: "Нет доступа" }, { status: 404 });
  }

  const members = await prisma.factionMember.findMany({
    where: { factionId: loaded.view.id },
    include: {
      user: {
        select: { id: true, nick: true, name: true, steamName: true, steamId: true },
      },
    },
  });
  const people = members
    .map((m) => m.user)
    .filter((u) => u && !isBuiltinSuperAdmin(u.steamId));

  const now = new Date();
  const today = ymdMsk(now);
  const days = Array.from({ length: 7 }, (_, i) => {
    const ymd = addDays(today, i - 6);
    return { ymd, weekday: weekdayOf(ymd), date: dateLabel(ymd) };
  });
  const windows = days.map((d) => ({
    ymd: d.ymd,
    start: mskAt(d.ymd, 20),
    end: mskAt(addDays(d.ymd, 1), 1),
  }));
  const from = windows[0].start;
  const to = windows[windows.length - 1].end;

  const userIds = people.map((u) => u.id);
  const steamIds = people.map((u) => u.steamId).filter((s): s is string => Boolean(s));
  const sessions =
    userIds.length === 0
      ? []
      : await prisma.squadServerSession.findMany({
          where: {
            serverKey: { in: [...TRAINING_SERVER_KEYS] },
            joinedAt: { lt: to },
            AND: [
              { OR: [{ leftAt: null }, { leftAt: { gt: from } }] },
              {
                OR: [
                  { userId: { in: userIds } },
                  ...(steamIds.length ? [{ steamId: { in: steamIds } }] : []),
                ],
              },
            ],
          },
          select: { userId: true, steamId: true, joinedAt: true, leftAt: true },
          orderBy: { joinedAt: "asc" },
        });

  const memberIds = new Set(people.map((u) => u.id));
  const idBySteam = new Map(people.filter((u) => u.steamId).map((u) => [u.steamId, u.id]));
  const visits = new Map<string, Visit[]>();
  for (const s of sessions) {
    const userId =
      s.userId && memberIds.has(s.userId) ? s.userId : idBySteam.get(s.steamId) || "";
    if (!userId) continue;
    const list = visits.get(userId) || [];
    list.push({ joinedAt: s.joinedAt, leftAt: s.leftAt });
    visits.set(userId, list);
  }

  const rows = people
    .map((u) => {
      const list = visits.get(u.id) || [];
      const cells: Record<string, string> = {};
      for (const w of windows) cells[w.ymd] = eveningSpan(list, w.start, w.end, now);
      return {
        userId: u.id,
        nick: u.nick || u.steamName || "—",
        name: u.name || "",
        cells,
      };
    })
    .sort((a, b) => a.nick.localeCompare(b.nick, "ru"));

  return NextResponse.json({ days, rows });
}
