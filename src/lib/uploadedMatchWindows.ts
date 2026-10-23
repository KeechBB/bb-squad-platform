/**
 * Окна залитых тренировочных матчей (KV training-index).
 * Роли / киты — только внутри этих интервалов (без пустых вечеров на Jensens).
 *
 * Важно: SquadRoleEvent.spawnedAt = timestamp WITHOUT time zone и хранит UTC
 * из лога. timeMsk на сайте — Москва (UTC+3). Сравниваем naive TIMESTAMP.
 * SERVER ONLY.
 */
import { Prisma } from "@prisma/client";
import { loadKvJsonCached } from "@/lib/kvLocal";

export type MatchTimeWindow = {
  /** naive DB wall as Date (UTC fields = wall clock) */
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

/**
 * spawnedAt в SquadRoleEvent — naive UTC (как в логе).
 * timeMsk на сайте — Москва, UTC+3.
 */
const DB_WALL_OFFSET_MIN = -3 * 60;

const MEM_TTL_MS = 90_000;
let mem: {
  at: number;
  /** Слитые соседние окна — фильтр «этот спавн внутри тренировки». */
  merged: MatchTimeWindow[];
  /** Окно каждого матча отдельно — потолок времени в ките, без паузы между катками. */
  slices: MatchTimeWindow[];
} | null = null;

export function isJensenMap(map: string | null | undefined): boolean {
  const m = String(map || "").toLowerCase();
  return m.includes("jensen");
}

export function parseDurationSec(raw: string | null | undefined): number | null {
  const s = String(raw || "").trim();
  if (!s || s === "—" || s === "-") return null;
  const parts = s.split(":").map((p) => Number(p));
  if (!parts.length || parts.some((n) => !Number.isFinite(n) || n < 0)) return null;
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  return null;
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

/** Собрать naive Date (UTC fields = wall) из ymd + минуты суток (могут быть <0 / >1440). */
function naiveFromYmdMinutes(ymd: string, dayMinutes: number): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const [y, mo, d] = ymd.split("-").map(Number);
  const base = Date.UTC(y, mo - 1, d, 0, 0, 0);
  return new Date(base + dayMinutes * 60_000);
}

function formatNaiveUtcFields(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  const ss = String(d.getUTCSeconds()).padStart(2, "0");
  return `${y}-${m}-${day} ${hh}:${mm}:${ss}`;
}

function resolveMonthUrl(url: string): string {
  const u = String(url || "").trim();
  if (!u) return "";
  if (u.startsWith("data/")) return u;
  if (u.startsWith("/kv-static/")) return u.slice("/kv-static/".length);
  if (u.startsWith("training/")) return `data/${u}`;
  return u.replace(/^\/+/, "");
}

/** Окна залитых TM. Кэш ~90с. slices — матч как есть, merged — соседние склеены. */
async function readTrainingWindows(): Promise<{
  merged: MatchTimeWindow[];
  slices: MatchTimeWindow[];
}> {
  if (mem && Date.now() - mem.at < MEM_TTL_MS) {
    return { merged: mem.merged, slices: mem.slices };
  }

  const idx = await loadKvJsonCached<TrainingIndex>("data/training-index.json");
  const months = idx?.months || [];
  const out: MatchTimeWindow[] = [];

  for (const ref of months) {
    const monthId = String(ref.id || ref.month || "").trim();
    const rel =
      resolveMonthUrl(String(ref.url || "")) ||
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
      const ymd = `${ym}-${String(day).padStart(2, "0")}`;
      const t = parseTimeMsk(match.timeMsk);
      const durSec = parseDurationSec(match.duration);
      // Без точного старта и длины матч не берём: широкий «весь вечер» тащил
      // прогрев и паузы между катками.
      if (!t || !durSec || durSec < 60) continue;
      // timeMsk МСК → naive UTC (МСК−3ч), паддинг −12/+3 мин
      const startMin = t.h * 60 + t.m + DB_WALL_OFFSET_MIN - 12;
      const endMin =
        t.h * 60 + t.m + DB_WALL_OFFSET_MIN + Math.ceil(durSec / 60) + 3;
      const gte = naiveFromYmdMinutes(ymd, startMin);
      const lt = naiveFromYmdMinutes(ymd, endMin);
      if (!gte || !lt) continue;
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
  const slices = out.map((w) => ({ ...w }));
  const merged: MatchTimeWindow[] = [];
  for (const w of out) {
    const last = merged[merged.length - 1];
    if (last && w.gte.getTime() <= last.lt.getTime() + 60_000) {
      if (w.lt > last.lt) last.lt = w.lt;
      continue;
    }
    merged.push({ ...w });
  }
  mem = { at: Date.now(), merged, slices };
  return { merged, slices };
}

/** Слитые окна залитых TM. Кэш ~90с. Фильтр «спавн попал в тренировку». */
export async function loadUploadedTrainingWindows(): Promise<MatchTimeWindow[]> {
  const { merged } = await readTrainingWindows();
  return merged;
}

/**
 * Окно каждого залитого матча отдельно.
 * Время в ките обрывается в конце этого матча и не перетекает в паузу и следующую катку.
 */
export async function loadUploadedTrainingSlices(): Promise<MatchTimeWindow[]> {
  const { slices } = await readTrainingWindows();
  return slices;
}

/** SQL: (gte, lt) naive TIMESTAMP для JOIN времени в ките. */
export function windowBoundsValuesSql(windows: MatchTimeWindow[]): Prisma.Sql {
  const tuples: Prisma.Sql[] = [];
  for (const w of windows) {
    const a = formatNaiveUtcFields(w.gte);
    const b = formatNaiveUtcFields(w.lt);
    if (
      !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(a) ||
      !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(b)
    ) {
      continue;
    }
    tuples.push(
      Prisma.raw(`(TIMESTAMP '${a}'::timestamp, TIMESTAMP '${b}'::timestamp)`)
    );
  }
  if (!tuples.length) {
    return Prisma.sql`(VALUES (TIMESTAMP '1970-01-01 00:00:00'::timestamp, TIMESTAMP '1970-01-01 00:00:00'::timestamp))`;
  }
  return Prisma.sql`(VALUES ${Prisma.join(tuples)})`;
}

/** SQL: spawnedAt (naive) внутри залитого матча. */
export function uploadedWindowsSql(windows: MatchTimeWindow[]): Prisma.Sql {
  if (!windows.length) return Prisma.sql`AND FALSE`;
  const parts = windows.map((w) => {
    const a = formatNaiveUtcFields(w.gte);
    const b = formatNaiveUtcFields(w.lt);
    // только наши цифры из парсера — безопасно для raw
    if (
      !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(a) ||
      !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(b)
    ) {
      return Prisma.sql`FALSE`;
    }
    return Prisma.raw(
      `("spawnedAt" >= TIMESTAMP '${a}' AND "spawnedAt" < TIMESTAMP '${b}')`
    );
  });
  return Prisma.sql`AND (${Prisma.join(parts, " OR ")})`;
}

export function clearUploadedMatchWindowsCache() {
  mem = null;
}
