/**
 * Panelka teamkills cache (disk) — instant on player card open.
 * Built by scripts/build_panelka_teamkills.py from /var/www/bb-squad-logs (since 2026-11-01).
 */
import fs from "fs";
import path from "path";

const STEAM_RE = /^7656\d{13}$/;
const CACHE_DIR = path.join(process.cwd(), "data", "cache", "panelka-teamkills");
const SINCE_DEFAULT = "2026-11-01";

export type PanelkaTeamkillRow = {
  date: string;
  clock: string;
  victim: string;
  victimSteamId?: string;
  server?: string;
  weapon?: string;
  map?: string;
  ymd?: string;
};

export type PanelkaTeamkillsCache = {
  steamId: string;
  updatedAt: string;
  since: string;
  count: number;
  rows: PanelkaTeamkillRow[];
};

function cachePath(steamId: string): string {
  return path.join(CACHE_DIR, `${steamId}.json`);
}

/** Read cached TKs for any Steam (registered or not). Empty if no cache yet. */
export function readPanelkaTeamkills(
  steamId: string,
  opts?: { serverKey?: string | null }
): PanelkaTeamkillsCache {
  const sid = String(steamId || "").trim();
  if (!STEAM_RE.test(sid)) {
    return {
      steamId: sid,
      updatedAt: "",
      since: SINCE_DEFAULT,
      count: 0,
      rows: [],
    };
  }
  const p = cachePath(sid);
  if (!fs.existsSync(p)) {
    return {
      steamId: sid,
      updatedAt: "",
      since: SINCE_DEFAULT,
      count: 0,
      rows: [],
    };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(p, "utf8")) as PanelkaTeamkillsCache;
    let rows = Array.isArray(raw.rows) ? raw.rows : [];
    const server = String(opts?.serverKey || "").trim().toUpperCase();
    if (server && server !== "ALL") {
      // Prefer current server, but if empty show all (admin still sees history)
      const filtered = rows.filter(
        (r) => String(r.server || "").toUpperCase() === server
      );
      if (filtered.length) rows = filtered;
    }
    return {
      steamId: sid,
      updatedAt: String(raw.updatedAt || ""),
      since: String(raw.since || SINCE_DEFAULT),
      count: rows.length,
      rows,
    };
  } catch {
    return {
      steamId: sid,
      updatedAt: "",
      since: SINCE_DEFAULT,
      count: 0,
      rows: [],
    };
  }
}

/** UI rows (date/clock/victim) — newest already in cache. */
export function panelkaTeamkillsForCard(
  steamId: string,
  serverKey?: string | null
): PanelkaTeamkillRow[] {
  return readPanelkaTeamkills(steamId, { serverKey }).rows.map((r) => ({
    date: r.date,
    clock: r.clock,
    victim: r.victim,
    victimSteamId: r.victimSteamId,
    server: r.server,
    weapon: r.weapon || "",
    map: r.map || "",
  }));
}
