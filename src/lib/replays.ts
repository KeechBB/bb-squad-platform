import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

export type ReplaySample = { t: number; x: number; y: number; z?: number };

export type ReplayTrack = {
  key: string;
  samples: ReplaySample[];
};

export type ReplayPayload = {
  id: string;
  title?: string;
  layer: string;
  mapKey?: string;
  map_name?: string;
  duration_ms: number;
  squad_version?: string;
  server?: string;
  recordedAt?: string;
  players: Array<{
    name?: string | null;
    steam_id?: string | null;
    eos_id?: string | null;
    team_id?: number | null;
    faction?: string | null;
    squad_id?: number | null;
  }>;
  tracks: {
    players: ReplayTrack[];
    vehicles: ReplayTrack[];
  };
  events: {
    kills: Array<Record<string, unknown>>;
    deployments: Array<Record<string, unknown>>;
  };
  teams?: Array<Record<string, unknown>>;
};

export type ReplayIndexEntry = {
  id: string;
  title: string;
  layer: string;
  mapKey: string;
  duration_ms: number;
  server?: string;
  recordedAt?: string;
  tracks_players: number;
  players: string[];
};

export type ReplayIndex = {
  version: number;
  matches: ReplayIndexEntry[];
};

function replaysDir(): string {
  return join(process.cwd(), "data", "replays");
}

export function listReplays(): ReplayIndexEntry[] {
  const indexPath = join(replaysDir(), "index.json");
  if (existsSync(indexPath)) {
    const idx = JSON.parse(readFileSync(indexPath, "utf-8")) as ReplayIndex;
    return idx.matches || [];
  }
  // fallback: any *.json except index
  const dir = replaysDir();
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json") && f !== "index.json")
    .map((f) => {
      const d = JSON.parse(readFileSync(join(dir, f), "utf-8")) as ReplayPayload;
      return {
        id: d.id || f.replace(/\.json$/, ""),
        title: d.title || d.layer,
        layer: d.layer,
        mapKey: d.mapKey || "Unknown",
        duration_ms: d.duration_ms,
        server: d.server,
        recordedAt: d.recordedAt,
        tracks_players: d.tracks?.players?.length || 0,
        players: (d.tracks?.players || []).map((t) => t.key),
      };
    });
}

export function getReplay(id: string): ReplayPayload | null {
  const safe = id.replace(/[^a-zA-Z0-9._-]/g, "");
  if (!safe || safe !== id) return null;
  const path = join(replaysDir(), `${safe}.json`);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf-8")) as ReplayPayload;
}

export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}
