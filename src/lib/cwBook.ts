/**
 * Ручная регистрация будущей КВ (админ-кнопка «Рега КВ»).
 * Пишет upcoming в календарь месяца + match.md в KV.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { clearKvMemCache, kvLocalRoots } from "@/lib/kvLocal";

export type CwBookInput = {
  /** Main | Junior | — (чужой КВ) */
  stack: "Main" | "Junior" | "—";
  /** Тег соперника без скобок */
  opp: string;
  /** Хост чужого КВ (NKLV / GRAD / …). Пусто = наша BB-встреча */
  clan?: string;
  /** 8…40 */
  format: number;
  /** День месяца 1–31 */
  day: number;
  /** Месяц 1–12 (по умолчанию текущий МСК) */
  month?: number;
  /** Год (по умолчанию текущий МСК) */
  year?: number;
  /** HH:MM в UTC */
  timeUtc: string;
  map: string;
  server: string;
  /** SEC / FCL / CSL / HOTDROP / … */
  rules: string;
};

function isBbSide(raw: string): boolean {
  const s = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  if (!s) return false;
  if (/^(bb|blackberry)(\s|$)/i.test(s)) return true;
  if (/^(main|junior|jun)\b/i.test(s)) return true;
  return false;
}

function cleanClanTag(raw: string): string {
  return String(raw || "")
    .replace(/^\[|\]$/g, "")
    .trim();
}

export type CwBookResult = {
  ok: boolean;
  id: string;
  row: Record<string, unknown>;
  calendarWrites: string[];
  matchMdWrites: string[];
  error?: string;
};

function mskNowParts(): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(new Date());
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value || 0);
  return { year: n("year"), month: n("month"), day: n("day") };
}

export function parseTimeHm(raw: string): { hh: number; mm: number } | null {
  const m = String(raw || "")
    .trim()
    .match(/^(\d{1,2})[:.](\d{2})$/);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return { hh, mm };
}

export function parseDateDm(
  raw: string,
  fallbackYear: number
): { day: number; month: number; year: number } | null {
  const s = String(raw || "").trim();
  const m = s.match(/^(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?$/);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  let year = m[3] ? Number(m[3]) : fallbackYear;
  if (year < 100) year += 2000;
  if (day < 1 || day > 31 || month < 1 || month > 12) return null;
  return { day, month, year };
}

/**
 * "BB Main vs 20Royals" | "Main vs X" | "Junior - TAG"
 * чужой: "NKLV vs RA" | "GRAD - IMP"
 */
export function parseTeamLine(raw: string): {
  stack: "Main" | "Junior" | "—";
  opp: string;
  clan?: string;
} | null {
  const s = String(raw || "").trim();
  if (!s) return null;
  const vs = s.split(/\s+vs\.?\s+/i);
  let left = s;
  let right = "";
  if (vs.length >= 2) {
    left = vs[0].trim();
    right = vs.slice(1).join(" vs ").trim();
  } else {
    const dash = s.split(/\s+[—–-]\s+/);
    if (dash.length >= 2) {
      left = dash[0].trim();
      right = dash.slice(1).join(" - ").trim();
    }
  }
  if (!right) return null;

  const leftBb = isBbSide(left);
  const rightBb = isBbSide(right);

  // Наша встреча: BB/Main/Junior vs TAG (или наоборот)
  if (leftBb || rightBb) {
    const bbSide = leftBb ? left : right;
    const oppSide = leftBb ? right : left;
    const stack: "Main" | "Junior" = /jun/i.test(bbSide) ? "Junior" : "Main";
    const opp = cleanClanTag(oppSide);
    if (!opp || isBbSide(opp)) return null;
    return { stack, opp };
  }

  // Чужой КВ: NKLV vs RA
  const clan = cleanClanTag(left);
  const opp = cleanClanTag(right);
  if (!clan || !opp || clan.toLowerCase() === opp.toLowerCase()) return null;
  return { stack: "—", clan, opp };
}

export function parseSize(raw: string): number | null {
  const m = String(raw || "")
    .trim()
    .match(/^(\d{1,2})\s*[vхx×]\s*(\d{1,2})$/i);
  if (!m) {
    const n = Number(String(raw || "").replace(/\D/g, ""));
    if (n >= 8 && n <= 50) return n;
    return null;
  }
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (a !== b || a < 8 || a > 50) return null;
  return a;
}

function slugOpp(tag: string): string {
  return (
    String(tag || "opp")
      .trim()
      .toLowerCase()
      .replace(/^\.+/, "")
      .replace(/[^a-z0-9а-яё]+/gi, "")
      .slice(0, 16) || "opp"
  );
}

function folderSlug(tag: string): string {
  return (
    String(tag || "OPP")
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9А-ЯЁ]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 24) || "OPP"
  );
}

function utcToMsk(hh: number, mm: number): { hh: string; mm: string } {
  const total = hh * 60 + mm + 3 * 60;
  const norm = ((total % (24 * 60)) + 24 * 60) % (24 * 60);
  return {
    hh: String(Math.floor(norm / 60)).padStart(2, "0"),
    mm: String(norm % 60).padStart(2, "0"),
  };
}

function calendarWritePaths(year: number, month: number): string[] {
  const file = `${year}-${String(month).padStart(2, "0")}.json`;
  const out = new Set<string>();
  for (const root of kvLocalRoots()) {
    out.add(path.join(root, "data", file));
  }
  for (const base of [
    "/var/www/blackberry-kv",
    "/var/www/blackberry-kv/public",
  ]) {
    out.add(path.join(base, "data", file));
  }
  out.add(
    path.resolve(process.cwd(), "..", "KV", "public", "data", file)
  );
  out.add(path.resolve(process.cwd(), "..", "KV", "data", file));
  return [...out];
}

function matchMdRoots(year: number, month: number, folder: string): string[] {
  const ym = `${year}-${String(month).padStart(2, "0")}`;
  const rel = path.join(ym, folder);
  const out = new Set<string>();
  for (const root of kvLocalRoots()) {
    out.add(path.join(root, rel));
  }
  out.add(path.join("/var/www/blackberry-kv", rel));
  out.add(path.join("/var/www/blackberry-kv", "public", rel));
  out.add(path.resolve(process.cwd(), "..", "KV", rel));
  out.add(path.resolve(process.cwd(), "..", "KV", "public", rel));
  return [...out];
}

function buildMatchMd(input: CwBookInput & {
  year: number;
  month: number;
  timeMsk: string;
  size: string;
}): string {
  const ymd = `${input.year}-${String(input.month).padStart(2, "0")}-${String(input.day).padStart(2, "0")}`;
  const today = mskNowParts();
  const booked = `${String(today.day).padStart(2, "0")}.${String(today.month).padStart(2, "0")}.${today.year}`;
  const foreign = Boolean(input.clan);
  if (foreign) {
    return [
      `# ${ymd} — ${input.clan} vs ${input.opp}`,
      ``,
      `Чужой КВ. Ещё не сыграно. Заявка **${booked}** (${input.clan} vs ${input.opp}).`,
      ``,
      `- **${input.timeUtc} UTC** / **${input.timeMsk} МСК**`,
      `- **${input.size}**`,
      `- Карта: **${input.map}**`,
      `- Сервер: **${input.server}**`,
      `- Правила: **${input.rules}**`,
      `- Состав: **чужой КВ**`,
      ``,
      `Заметки: [analytics.md](analytics.md).`,
      ``,
    ].join("\n");
  }
  const stackRu = input.stack === "Junior" ? "junior-стак" : "мейн-стак";
  return [
    `# ${ymd} — ${input.opp} vs BlackBerry`,
    ``,
    `Ещё не сыграно. Заявка **${booked}**. Играет **${stackRu}** (BB ${input.stack} vs ${input.opp}).`,
    ``,
    `- **${input.timeUtc} UTC** / **${input.timeMsk} МСК**`,
    `- **${input.size}**`,
    `- Карта: **${input.map}**`,
    `- Сервер: **${input.server}**`,
    `- Правила: **${input.rules}**`,
    `- Состав: **${stackRu}**`,
    ``,
    `Лого: \`brand/logos/blackberry.png\`.`,
    ``,
    `Заметки: [analytics.md](analytics.md).`,
    ``,
  ].join("\n");
}

type CalMatch = Record<string, unknown> & {
  id?: string;
  day?: number;
  status?: string;
};

async function upsertCalendar(
  filePath: string,
  row: CalMatch
): Promise<"inserted" | "updated" | "kept" | "skip"> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch {
    // создать минимальный файл если рядом живёт KV
    try {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      const seed = {
        year: Number(String(filePath).match(/(\d{4})-\d{2}\.json/)?.[1] || 0),
        month: Number(String(filePath).match(/\d{4}-(\d{2})\.json/)?.[1] || 0),
        matches: [row],
      };
      await fs.writeFile(
        filePath,
        `${JSON.stringify(seed, null, 2)}\n`,
        "utf8"
      );
      return "inserted";
    } catch {
      return "skip";
    }
  }
  let data: { matches?: CalMatch[]; [k: string]: unknown };
  try {
    data = JSON.parse(raw) as { matches?: CalMatch[] };
  } catch {
    return "skip";
  }
  const matches = Array.isArray(data.matches) ? [...data.matches] : [];
  const byId = matches.findIndex((m) => m.id && m.id === row.id);
  if (byId >= 0) {
    const cur = matches[byId];
    const st = String(cur.status || "");
    if (st === "win" || st === "lose" || st === "cancel") return "kept";
    matches[byId] = { ...cur, ...row, id: cur.id || row.id };
    data.matches = matches;
    await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    return "updated";
  }
  const day = Number(row.day) || 0;
  let at = matches.findIndex((m) => Number(m.day) > day);
  if (at < 0) at = matches.length;
  // same day: after existing same-day rows
  while (
    at < matches.length &&
    Number(matches[at].day) === day
  ) {
    at += 1;
  }
  // if colliding id somehow, uniquify
  let id = String(row.id);
  if (matches.some((m) => m.id === id)) {
    id = `${id}-2`;
    row = { ...row, id };
  }
  matches.splice(at, 0, row);
  data.matches = matches;
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  return "inserted";
}

async function bumpCacheBust(note: string) {
  const bust = {
    bust: `cw-book-${Date.now().toString(36)}`,
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
      /* optional */
    }
  }
}

export function buildBookRow(input: CwBookInput): {
  row: CalMatch;
  year: number;
  month: number;
  folder: string;
  matchMd: string;
} {
  const now = mskNowParts();
  const year = input.year || now.year;
  const month = input.month || now.month;
  const t = parseTimeHm(input.timeUtc);
  if (!t) throw new Error("bad_time");
  const msk = utcToMsk(t.hh, t.mm);
  const timeUtc = `${String(t.hh).padStart(2, "0")}:${String(t.mm).padStart(2, "0")}`;
  const timeMsk = `${msk.hh}:${msk.mm}`;
  const size = `${input.format}v${input.format}`;
  const rules = String(input.rules || "").trim().toUpperCase() || "SEC";
  const opp = cleanClanTag(input.opp);
  const clan = cleanClanTag(input.clan || "");
  const foreign = Boolean(clan);
  const stack = foreign ? "—" : input.stack === "Junior" ? "Junior" : "Main";
  const map = String(input.map || "").trim();
  const server = String(input.server || "").trim();
  const id = foreign
    ? `${input.day}-${slugOpp(clan)}-${slugOpp(opp)}`
    : `${input.day}-${slugOpp(opp)}`;
  const folder = foreign
    ? `${String(input.day).padStart(2, "0")}-${folderSlug(clan)}-${folderSlug(opp)}`
    : `${String(input.day).padStart(2, "0")}-${folderSlug(opp)}`;
  const note = foreign
    ? [
        "чужой КВ",
        `${clan} vs ${opp}`,
        map,
        size,
        rules,
        server,
        `заявка (сайт · Рега КВ)`,
        "NO SCOUT",
        "NO MEETINGS",
      ].join(" · ")
    : [
        stack,
        rules,
        map,
        size,
        timeMsk,
        `сервер ${server}`,
        "заявка (сайт · Рега КВ)",
        "NO SCOUT",
        "NO MEETINGS",
      ].join(" · ");

  const row: CalMatch = {
    id,
    day: input.day,
    timeMsk,
    timeUtc,
    ...(foreign ? { clan } : {}),
    opp,
    map,
    size,
    server,
    rules,
    stack,
    status: "upcoming",
    note,
    mode: rules,
  };

  const matchMd = buildMatchMd({
    ...input,
    year,
    month,
    timeUtc,
    timeMsk,
    size,
    opp,
    rules,
  });

  return { row, year, month, folder, matchMd };
}

export async function bookClanWar(input: CwBookInput): Promise<CwBookResult> {
  try {
    if (!input.opp?.trim()) {
      return { ok: false, id: "", row: {}, calendarWrites: [], matchMdWrites: [], error: "opp" };
    }
    if (!input.format || input.format < 8) {
      return { ok: false, id: "", row: {}, calendarWrites: [], matchMdWrites: [], error: "format" };
    }
    if (!input.day || input.day < 1 || input.day > 31) {
      return { ok: false, id: "", row: {}, calendarWrites: [], matchMdWrites: [], error: "day" };
    }
    if (!parseTimeHm(input.timeUtc)) {
      return { ok: false, id: "", row: {}, calendarWrites: [], matchMdWrites: [], error: "time" };
    }
    if (!input.map?.trim() || !input.server?.trim() || !input.rules?.trim()) {
      return { ok: false, id: "", row: {}, calendarWrites: [], matchMdWrites: [], error: "fields" };
    }

    const built = buildBookRow(input);
    const calendarWrites: string[] = [];
    for (const p of calendarWritePaths(built.year, built.month)) {
      try {
        const r = await upsertCalendar(p, built.row);
        if (r !== "skip") calendarWrites.push(`${r}:${p}`);
      } catch (e) {
        calendarWrites.push(`err:${p}:${e instanceof Error ? e.message : "x"}`);
      }
    }

    const matchMdWrites: string[] = [];
    for (const dir of matchMdRoots(built.year, built.month, built.folder)) {
      try {
        await fs.mkdir(dir, { recursive: true });
        const mdPath = path.join(dir, "match.md");
        // не затирать уже оцифрованный матч
        try {
          const prev = await fs.readFile(mdPath, "utf8");
          if (/итоговый счёт|финал|FINAL|R1\s+\d/i.test(prev)) {
            matchMdWrites.push(`kept:${mdPath}`);
            continue;
          }
        } catch {
          /* new file */
        }
        await fs.writeFile(mdPath, built.matchMd, "utf8");
        const an = path.join(dir, "analytics.md");
        try {
          await fs.access(an);
        } catch {
          await fs.writeFile(
            an,
            `# Analytics — ${built.folder}\n\nЗаявка через «Рега КВ».\n`,
            "utf8"
          );
        }
        matchMdWrites.push(`ok:${mdPath}`);
      } catch (e) {
        matchMdWrites.push(`err:${dir}:${e instanceof Error ? e.message : "x"}`);
      }
    }

    if (calendarWrites.some((r) => r.startsWith("inserted") || r.startsWith("updated"))) {
      await bumpCacheBust(`book ${built.row.id} vs ${input.opp}`);
      clearKvMemCache();
    }

    return {
      ok: calendarWrites.some((r) => r.startsWith("inserted") || r.startsWith("updated")),
      id: String(built.row.id),
      row: built.row,
      calendarWrites,
      matchMdWrites,
    };
  } catch (e) {
    return {
      ok: false,
      id: "",
      row: {},
      calendarWrites: [],
      matchMdWrites: [],
      error: e instanceof Error ? e.message : "fail",
    };
  }
}
