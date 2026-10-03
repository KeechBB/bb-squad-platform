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

export async function loadPublicRpLedger(): Promise<RpLedger | null> {
  noStore();
  // VPS / local primary: written by build_public_rp_ledger.py
  try {
    const { readFile } = await import("fs/promises");
    const { join } = await import("path");
    const candidates = [
      join(process.cwd(), "data", "public", "rp-ledger.json"),
      join(process.cwd(), "..", "KV", "public", "data", "public", "rp-ledger.json"),
    ];
    for (const p of candidates) {
      try {
        const raw = await readFile(p, "utf8");
        const data = JSON.parse(raw) as RpLedger;
        if (data?.players && Object.keys(data.players).length > 0) return data;
        if (data?.leaderboard?.length) return data;
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
      const n = data?.players ? Object.keys(data.players).length : 0;
      if (n > 0 || (data?.leaderboard?.length ?? 0) > 0) return data;
    } catch {
      /* next */
    }
  }
  return null;
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
