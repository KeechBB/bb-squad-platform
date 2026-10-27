/**
 * Train accuracy (Точн.%): hits/shots from accuracy-stats.json.
 * SERVER ONLY — never import from "use client" components.
 */
import { loadKvJsonCached } from "@/lib/kvLocal";
import { rollingMainRoleWindow } from "@/lib/mainRoleWindow";

export type AccuracySlot = {
  hits: number;
  shots: number;
  accuracyPct: number | null;
  day?: string;
};

export type AccuracyNickRow = AccuracySlot & {
  nick: string;
  matches?: number;
  days?: number;
  byMatch?: Record<string, AccuracySlot>;
};

type AccuracyFile = {
  meta?: unknown;
  byNick?: Record<string, AccuracyNickRow>;
};

function nickKey(n: string): string {
  return String(n || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

export async function loadAccuracyStats(): Promise<AccuracyFile | null> {
  return loadKvJsonCached<AccuracyFile>("data/training/accuracy-stats.json");
}

export async function accuracyForNick(
  nick: string,
  matchId?: string | null
): Promise<AccuracySlot | null> {
  const n = String(nick || "").trim();
  if (!n) return null;
  const file = await loadAccuracyStats();
  const by = file?.byNick || {};
  const key = nickKey(n);
  let row = by[key];
  if (!row) {
    row = Object.values(by).find(
      (r) => nickKey(String(r?.nick || "")) === key
    ) as AccuracyNickRow | undefined;
  }
  if (!row) return null;

  const mid = String(matchId || "").trim();
  if (mid) {
    const slot = row.byMatch?.[mid];
    if (!slot) return null;
    const hits = Number(slot.hits) || 0;
    const shots = Number(slot.shots) || 0;
    const pct =
      slot.accuracyPct != null
        ? Number(slot.accuracyPct)
        : shots > 0 && hits > 0
          ? Math.min(100, Math.round((1000 * hits) / shots) / 10)
          : null;
    if (shots <= 0 || hits <= 0 || pct == null) return null;
    return { hits, shots, accuracyPct: pct };
  }

  const win = await windowedAccuracy(row);
  if (!win) return null;
  return win;
}

let matchDaysPromise: Promise<Record<string, string>> | null = null;

function trainMatchDays(): Promise<Record<string, string>> {
  if (!matchDaysPromise) {
    matchDaysPromise = loadTrainMatchDays().catch((err) => {
      matchDaysPromise = null;
      throw err;
    });
  }
  return matchDaysPromise;
}

async function loadTrainMatchDays(): Promise<Record<string, string>> {
  const index = await loadKvJsonCached<{
    months?: { url?: string; year?: number; month?: number }[];
  }>("data/training-index.json");
  const out: Record<string, string> = {};
  for (const m of index?.months || []) {
    if (!m?.url || !m.year || !m.month) continue;
    const doc = await loadKvJsonCached<{
      matches?: { id?: string; day?: number }[];
    }>(String(m.url).replace(/^\//, ""));
    for (const match of doc?.matches || []) {
      const id = String(match?.id || "");
      const day = Number(match?.day) || 0;
      if (!id || !day) continue;
      out[id] = `${m.year}-${String(m.month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }
  return out;
}

/** Сумма слотов за те же 14 суток МСК, что роль и попадания. */
async function windowedAccuracy(
  row: AccuracyNickRow
): Promise<AccuracySlot | null> {
  const { from, to } = rollingMainRoleWindow();
  const days = await trainMatchDays().catch(() => ({} as Record<string, string>));
  const by = row.byMatch || {};
  let hits = 0;
  let shots = 0;
  let dated = 0;
  for (const [mid, slot] of Object.entries(by)) {
    const day = String(slot?.day || days[mid] || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    dated += 1;
    if (day < from || day > to) continue;
    const h = Number(slot.hits) || 0;
    const s = Number(slot.shots) || 0;
    if (s <= 0 || h <= 0 || h > s) continue;
    hits += h;
    shots += s;
  }
  if (!dated || shots < 20 || hits <= 0) return null;
  return {
    hits,
    shots,
    accuracyPct: Math.min(100, Math.round((1000 * hits) / shots) / 10),
  };
}
