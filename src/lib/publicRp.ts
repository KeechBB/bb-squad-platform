/**
 * Public (PB1) Respect Points — same ladder UI as train RP.
 * Weight uses current public RP (not PWR). Ledger built offline from TPUB1 logs
 * excluding SEED layers → data/public/rp-ledger.json
 */
import { unstable_noStore as noStore } from "next/cache";
import { rpRankFromScore, type RpLeaderRow, type RpLedger, type RpPlayer } from "@/lib/trainRp";

const KV_BASES = [
  process.env.KV_DATA_BASE,
  "https://keechbb.github.io/blackberry-kv",
].filter(Boolean) as string[];

function nickKey(n: string) {
  return String(n || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

async function fetchJson(url: string) {
  const res = await fetch(url, { next: { revalidate: 60 } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** Public rating starts 2026-10-03; reject pre-epoch / non-history ledgers. */
const PUBLIC_RP_EPOCH = (process.env.PUBLIC_RP_EPOCH || "2026-10-03").trim();

function isCurrentPublicLedger(data: RpLedger | null | undefined): boolean {
  if (!data) return false;
  const nPlayers = data.players ? Object.keys(data.players).length : 0;
  if (!nPlayers && !(data.leaderboard?.length ?? 0)) return false;
  if (data.historyOnly && data.epoch && data.epoch >= PUBLIC_RP_EPOCH) {
    return true;
  }
  const matches = data.matches || [];
  if (!matches.length) return false;
  // Stale full-log ledger (Sept…) — do not use.
  if (matches.some((m) => m.date && m.date < PUBLIC_RP_EPOCH)) return false;
  return matches.every((m) => !m.date || m.date >= PUBLIC_RP_EPOCH);
}

export async function loadPublicRpLedger(): Promise<RpLedger | null> {
  noStore();
  const candidates: RpLedger[] = [];

  // Disk first, then KV — but only accept history/epoch ledgers.
  try {
    const { readFile } = await import("fs/promises");
    const { join } = await import("path");
    for (const p of [
      join(process.cwd(), "data", "public", "rp-ledger.json"),
      join(process.cwd(), "..", "KV", "public", "data", "public", "rp-ledger.json"),
    ]) {
      try {
        const data = JSON.parse(await readFile(p, "utf8")) as RpLedger;
        if (isCurrentPublicLedger(data)) return data;
        if (data?.leaderboard?.length) candidates.push(data);
      } catch {
        /* next path */
      }
    }
  } catch {
    /* fs unavailable */
  }

  for (const base of KV_BASES) {
    try {
      const data = (await fetchJson(
        `${base.replace(/\/$/, "")}/data/public/rp-ledger.json`
      )) as RpLedger;
      if (isCurrentPublicLedger(data)) return data;
      if (data?.leaderboard?.length) candidates.push(data);
    } catch {
      /* next */
    }
  }

  // Last resort: newest-looking candidate (should not happen after cutover).
  return candidates[0] || null;
}

export async function buildPublicRpLeaderboard(): Promise<{
  rows: RpLeaderRow[];
  players: number;
  matches: number;
  updatedAt: string;
  available: boolean;
}> {
  const ledger = await loadPublicRpLedger();
  if (!ledger?.leaderboard?.length) {
    return {
      rows: [],
      players: 0,
      matches: 0,
      updatedAt: new Date().toISOString(),
      available: false,
    };
  }
  const rows: RpLeaderRow[] = ledger.leaderboard.map((r, i) => {
    const p = ledger.players[nickKey(r.nick)];
    const rank = r.predatorPlace
      ? { label: `PREDATOR #${r.predatorPlace}`, key: "predator" }
      : {
          label: r.rankLabel || rpRankFromScore(r.rp, ledger.step, ledger.radiant3Max).label,
          key: r.rankKey,
        };
    return {
      nick: r.nick,
      rp: r.rp,
      rankLabel: rank.label,
      rankKey: rank.key,
      predatorPlace: r.predatorPlace ?? null,
      place: i + 1,
      games: p?.matches?.length || 0,
    };
  });
  return {
    rows,
    players: rows.length,
    matches: ledger.matches?.length || 0,
    updatedAt: new Date().toISOString(),
    available: true,
  };
}

export async function lookupPlayerPublicRp(nick: string): Promise<RpPlayer | null> {
  const ledger = await loadPublicRpLedger();
  if (!ledger) return null;
  const key = nickKey(nick);
  const direct = ledger.players[key];
  if (direct) return direct;
  for (const p of Object.values(ledger.players)) {
    if (nickKey(p.nick) === key) return p;
  }
  return null;
}
