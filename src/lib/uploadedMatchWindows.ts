/**
 * Окна залитых тренировочных матчей (KV training-index).
 * Роли / киты — только внутри этих интервалов (без пустых вечеров на Jensens).
 *
 * Важно: SquadRoleEvent.spawnedAt = timestamp WITHOUT time zone, и в практике
 * стенка в БД ≈ timeMsk МСК минус 2 часа (лог-часы сервера). Сравниваем
 * naive TIMESTAMP, без timestamptz-конвертаций Prisma.
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

/** Логи в БД отстают от timeMsk на сайте примерно на 2 часа. */
const DB_WALL_OFFSET_MIN = -2 * 60;

const MEM_TTL_MS = 90_000;
let mem: { at: number; windows: MatchTimeWindow[] } | null = null;

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

function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

/**
 * Все окна залитых TM. Кэш ~90с.
 */
export async function loadUploadedTrainingWindows(): Promise<MatchTimeWindow[]> {
  if (mem && Date.now() - mem.at < MEM_TTL_MS) return mem.windows;

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

    const dayCombatFallback = new Set<string>();

    for (const match of file.matches || []) {
      if (match.status && match.status !== "done") continue;
      const map = String(match.map || "");
      if (isJensenMap(map)) continue;
      const day = Number(match.day);
      if (!Number.isFinite(day) || day < 1 || day > 31) continue;
      const ymd = `${ym}-${String(day).padStart(2, "0")}`;
      const t = parseTimeMsk(match.timeMsk);
      const durSec = parseDurationSec(match.duration);
      if (!t || !durSec || durSec < 60) {
        dayCombatFallback.add(ymd);
        continue;
      }
      // timeMsk МСК → naive DB wall (MSK − 2ч), паддинг −12/+3 мин
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

    // Дни без точного timeMsk: вечерние логи 18:30–01:00 naive (как empirically combat)
    for (const ymd of dayCombatFallback) {
      const gte = naiveFromYmdMinutes(ymd, 18 * 60 + 30);
      const lt = naiveFromYmdMinutes(addDaysYmd(ymd, 1), 1 * 60);
      if (!gte || !lt) continue;
      out.push({
        gte,
        lt,
        map: "day-fallback",
        id: `day-${ymd}`,
        month: ym,
      });
    }
  }

  out.sort((a, b) => a.gte.getTime() - b.gte.getTime());
  const merged: MatchTimeWindow[] = [];
  for (const w of out) {
    const last = merged[merged.length - 1];
    if (last && w.gte.getTime() <= last.lt.getTime() + 60_000) {
      if (w.lt > last.lt) last.lt = w.lt;
      continue;
    }
    merged.push({ ...w });
  }
  mem = { at: Date.now(), windows: merged };
  return merged;
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
