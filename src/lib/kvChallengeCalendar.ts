/**
 * Принятая заявка КВ → слот в KV-календаре (история /cw).
 * Календарь клана на сайте пишет ClanCalendarEvent отдельно;
 * без этого хелпера матч не появляется в «Клановых войнах».
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { clearKvMemCache, kvLocalRoots } from "@/lib/kvLocal";
import { modeLabel, type CwModeId } from "@/lib/cwChallenge";

export type ChallengeKvPublishInput = {
  challengeId: string;
  mode: string;
  format: number;
  scheduledAt: Date;
  /** Тег соперника для слота BB (opp) */
  oppTag: string;
  /** Состав BB на матч */
  bbStack: string | null;
  assignedServer?: string | null;
};

type CalMatch = Record<string, unknown> & {
  id?: string;
  day?: number;
  status?: string;
  challengeId?: string;
};

type CalFile = {
  matches?: CalMatch[];
  [k: string]: unknown;
};

function mskParts(d: Date): {
  year: number;
  month: number;
  day: number;
  hh: string;
  mm: string;
} {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value || 0);
  return {
    year: n("year"),
    month: n("month"),
    day: n("day"),
    hh: String(n("hour")).padStart(2, "0"),
    mm: String(n("minute")).padStart(2, "0"),
  };
}

function slugOpp(tag: string): string {
  return String(tag || "opp")
    .trim()
    .toLowerCase()
    .replace(/^\.+/, "")
    .replace(/[^a-z0-9а-яё]+/gi, "")
    .slice(0, 12) || "opp";
}

function mapLabelForMode(mode: string): string {
  const m = String(mode || "").toUpperCase();
  if (m === "HOTDROP") return "HotDrop TBA";
  if (m === "FCL") return "FCL TBA";
  if (m === "CSL") return "CSL TBA";
  if (m === "SEC") return "SEC TBA";
  return "TBA";
}

function normalizeStack(stack: string | null | undefined): string {
  const s = String(stack || "").trim();
  if (!s) return "Main";
  if (/jun/i.test(s)) return "Junior";
  if (/main/i.test(s)) return "Main";
  return s;
}

export function buildChallengeCalendarRow(
  input: ChallengeKvPublishInput
): CalMatch {
  const { year, month, day, hh, mm } = mskParts(input.scheduledAt);
  void year;
  void month;
  const opp = String(input.oppTag || "?").replace(/^\[|\]$/g, "").trim() || "?";
  const stack = normalizeStack(input.bbStack);
  const mode = String(input.mode || "HOTDROP").toUpperCase();
  const size = `${input.format}v${input.format}`;
  const server =
    String(input.assignedServer || "").trim() || "после матчмейкинга";
  const map = mapLabelForMode(mode);
  const rules = mode;
  const timeMsk = `${hh}:${mm}`;
  const utcH = (Number(hh) - 3 + 24) % 24;
  const timeUtc = `${String(utcH).padStart(2, "0")}:${mm}`;
  const modeRu = modeLabel(mode as CwModeId);
  const id = `${day}-${slugOpp(opp)}`;
  const note = [
    stack,
    modeRu || mode,
    map,
    size,
    timeMsk,
    `сервер ${server}`,
    "заявка (принята на сайте)",
    "NO SCOUT",
    "NO MEETINGS",
  ].join(" · ");

  return {
    id,
    day,
    timeMsk,
    timeUtc,
    opp,
    map,
    size,
    server,
    rules,
    stack,
    status: "upcoming",
    note,
    challengeId: input.challengeId,
  };
}

function calendarWritePaths(year: number, month: number): string[] {
  const file = `${year}-${String(month).padStart(2, "0")}.json`;
  const rel = path.join("data", file);
  const out = new Set<string>();
  for (const root of kvLocalRoots()) {
    out.add(path.join(root, rel));
  }
  // warehouse mirrors (VPS)
  for (const base of [
    "/var/www/blackberry-kv",
    "/var/www/blackberry-kv/public",
  ]) {
    out.add(path.join(base, "data", file));
  }
  // local monorepo checkout (dev machine)
  const localKv = path.resolve(process.cwd(), "..", "KV", "public", "data", file);
  out.add(localKv);
  return [...out];
}

async function upsertRowInFile(
  filePath: string,
  row: CalMatch
): Promise<"inserted" | "updated" | "kept" | "skip"> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch {
    return "skip";
  }
  let data: CalFile;
  try {
    data = JSON.parse(raw) as CalFile;
  } catch {
    return "skip";
  }
  const matches = Array.isArray(data.matches) ? [...data.matches] : [];
  const byChallenge = matches.findIndex(
    (m) =>
      m.challengeId &&
      row.challengeId &&
      String(m.challengeId) === String(row.challengeId)
  );
  const byId = matches.findIndex((m) => m.id && m.id === row.id);
  const idx = byChallenge >= 0 ? byChallenge : byId;

  if (idx >= 0) {
    const cur = matches[idx];
    const st = String(cur.status || "");
    if (st === "win" || st === "lose" || st === "cancel") {
      // уже оцифрован / отменён вручную — не затираем
      if (!cur.challengeId && row.challengeId) {
        matches[idx] = { ...cur, challengeId: row.challengeId };
        data.matches = matches;
        await fs.writeFile(
          filePath,
          `${JSON.stringify(data, null, 2)}\n`,
          "utf8"
        );
        return "updated";
      }
      return "kept";
    }
    matches[idx] = { ...cur, ...row, id: cur.id || row.id };
    data.matches = matches;
    await fs.writeFile(
      filePath,
      `${JSON.stringify(data, null, 2)}\n`,
      "utf8"
    );
    return "updated";
  }

  // вставить по дню / времени
  const day = Number(row.day) || 0;
  let at = matches.findIndex((m) => Number(m.day) > day);
  if (at < 0) at = matches.length;
  matches.splice(at, 0, row);
  data.matches = matches;
  await fs.writeFile(
    filePath,
    `${JSON.stringify(data, null, 2)}\n`,
    "utf8"
  );
  return "inserted";
}

async function bumpCacheBust(note: string) {
  const bust = {
    bust: `cw-challenge-${Date.now().toString(36)}`,
    updatedAt: new Date().toISOString(),
    note,
  };
  const targets = new Set<string>();
  for (const root of kvLocalRoots()) {
    targets.add(path.join(root, "data", "cache-bust.json"));
  }
  targets.add("/var/www/blackberry-kv/data/cache-bust.json");
  targets.add("/var/www/blackberry-kv/public/data/cache-bust.json");
  for (const p of targets) {
    try {
      await fs.mkdir(path.dirname(p), { recursive: true });
      await fs.writeFile(p, JSON.stringify(bust, null, 2), "utf8");
    } catch {
      /* optional path */
    }
  }
}

/**
 * Пишет upcoming-слот в KV-календари. Не бросает — accept не должен падать.
 */
export async function publishAcceptedChallengeToKv(
  input: ChallengeKvPublishInput
): Promise<{ ok: boolean; id: string; results: string[] }> {
  const row = buildChallengeCalendarRow(input);
  const { year, month } = mskParts(input.scheduledAt);
  const paths = calendarWritePaths(year, month);
  const results: string[] = [];
  for (const p of paths) {
    try {
      const r = await upsertRowInFile(p, row);
      if (r !== "skip") results.push(`${r}:${p}`);
    } catch (e) {
      results.push(`err:${p}:${e instanceof Error ? e.message : "x"}`);
    }
  }
  if (results.some((r) => r.startsWith("inserted") || r.startsWith("updated"))) {
    await bumpCacheBust(
      `accepted ${row.id} vs ${row.opp} (${input.challengeId})`
    );
    clearKvMemCache();
  }
  return { ok: results.length > 0, id: String(row.id), results };
}

/** Пометить слот cancel по challengeId (если когда-нибудь отменим accepted). */
export async function cancelChallengeInKv(
  challengeId: string,
  scheduledAt: Date
): Promise<void> {
  const { year, month } = mskParts(scheduledAt);
  for (const p of calendarWritePaths(year, month)) {
    try {
      const raw = await fs.readFile(p, "utf8");
      const data = JSON.parse(raw) as CalFile;
      const matches = Array.isArray(data.matches) ? data.matches : [];
      let changed = false;
      for (const m of matches) {
        if (String(m.challengeId || "") !== challengeId) continue;
        const st = String(m.status || "");
        if (st === "win" || st === "lose") continue;
        m.status = "cancel";
        const note = String(m.note || "");
        if (!/отмена/i.test(note)) {
          m.note = `отмена · ${note}`.trim();
        }
        changed = true;
      }
      if (changed) {
        data.matches = matches;
        await fs.writeFile(
          p,
          `${JSON.stringify(data, null, 2)}\n`,
          "utf8"
        );
      }
    } catch {
      /* skip */
    }
  }
  clearKvMemCache();
}
