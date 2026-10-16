/**
 * Окна залитых тренировочных матчей (KV training-index).
 * Роли / киты считаем только внутри этих интервалов — без AFK на Jensens.
 * SERVER ONLY.
 */
import { Prisma } from "@prisma/client";
import { loadKvJsonCached } from "@/lib/kvLocal";

export type MatchTimeWindow = {
  gte: Date;
  lt: Date;
  map: string;
  id: string;
  month: string;
};

type TrainingIndex = {
  months?: { id?: string; url?: string; month?: string }[];
};

type TrainingMonthFile = {
  month?: string;
  matches?: {
    id?: string;
    day?: number;
    timeMsk?: string;
    duration?: string;
    map?: string;
    status?: string;
  }[];
};

const MEM_TTL_MS = 90_000;
let mem: { at: number; windows: MatchTimeWindow[] } | null = null;

/** Jensens Range / практика — не боевые катки. */
export function isJensenMap(map: string | null | undefined): boolean {
  const m = String(map || "").toLowerCase();
  return m.includes("jensen");
}

/** "48:46" → MM:SS; "01:02:52" → HH:MM:SS */
export function parseDurationSec(raw: string | null | undefined): number | null {
  const s = String(raw || "").trim();
  if (!s || s === "—" || s === "-") return null;
  const parts = s.split(":").map((p) => Number(p));
  if (!parts.length || parts.some((n) => !Number.isFinite(n) || n < 0)) return null;
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  if (parts.length === 2) {
    // в логах тренировок двухчастное = MM:SS (не HH:MM)
    return parts[0] * 60 + parts[1];
  }
  return null;
}

/** Стена МСК YYYY-MM-DD + HH:MM → UTC (MSK = UTC+3, без DST). */
export function mskWallToUtc(
  ymd: string,
  hour: number,
  minute: number,
  second = 0
): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  if (
    !Number.isFinite(hour) ||
    !Number.isFinite(minute) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return null;
  }
  const [y, m, d] = ymd.split("-").map(Number);
  const utcMs = Date.UTC(y, m - 1, d, hour, minute, second) - 3 * 3600_000;
  const dt = new Date(utcMs);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function parseTimeMsk(raw: string | null | undefined): { h: number; m: number } | null {
  const s = String(raw || "").trim();
  if (!s || s === "—" || s === "-") return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min) || h > 23 || min > 59) return null;
  return { h, m: min };
}

function resolveMonthUrl(url: string): string {
  const u = String(url || "").trim();
  if (!u) return "";
  if (u.startsWith("data/")) return u;
  if (u.startsWith("/kv-static/")) return u.slice("/kv-static/".length);
  if (u.startsWith("training/")) return `data/${u}`;
  return u.replace(/^\/+/, "");
}

/**
 * Все окна залитых TM (status done / без статуса), без Jensens.
 * Кэш ~90с в процессе.
 */
export async function loadUploadedTrainingWindows(): Promise<MatchTimeWindow[]> {
  if (mem && Date.now() - mem.at < MEM_TTL_MS) return mem.windows;

  const idx = await loadKvJsonCached<TrainingIndex>("data/training-index.json");
  const months = idx?.months || [];
  const out: MatchTimeWindow[] = [];

  for (const ref of months) {
    const monthId = String(ref.id || ref.month || "").trim();
    const rel = resolveMonthUrl(String(ref.url || "")) ||
      (monthId ? `data/training/${monthId}.json` : "");
    if (!rel) continue;
    const file = await loadKvJsonCached<TrainingMonthFile>(rel);
    if (!file) continue;
    const ym = String(file.month || monthId || "").trim();
    if (!/^\d{4}-\d{2}$/.test(ym)) continue;
    for (const match of file.matches || []) {
      if (match.status && match.status !== "done") continue;
      const map = String(match.map || "");
      if (isJensenMap(map)) continue;
      const day = Number(match.day);
      if (!Number.isFinite(day) || day < 1 || day > 31) continue;
      const t = parseTimeMsk(match.timeMsk);
      const durSec = parseDurationSec(match.duration);
      if (!t || !durSec || durSec < 60) continue;
      const ymd = `${ym}-${String(day).padStart(2, "0")}`;
      const gte = mskWallToUtc(ymd, t.h, t.m, 0);
      if (!gte) continue;
      // небольшой хвост +90с — последний спавн у финиша катки
      const lt = new Date(gte.getTime() + (durSec + 90) * 1000);
      out.push({
        gte,
        lt,
        map,
        id: String(match.id || `${ym}-${day}`),
        month: ym,
      });
    }
  }

  out.sort((a, b) => a.gte.getTime() - b.gte.getTime());
  mem = { at: Date.now(), windows: out };
  return out;
}

/** SQL: spawnedAt внутри хотя бы одного залитого матча. Без окон → AND FALSE. */
export function uploadedWindowsSql(windows: MatchTimeWindow[]): Prisma.Sql {
  if (!windows.length) return Prisma.sql`AND FALSE`;
  const parts = windows.map(
    (w) =>
      Prisma.sql`("spawnedAt" >= ${w.gte} AND "spawnedAt" < ${w.lt})`
  );
  return Prisma.sql`AND (${Prisma.join(parts, " OR ")})`;
}

export function clearUploadedMatchWindowsCache() {
  mem = null;
}
