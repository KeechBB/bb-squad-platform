import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { formatDuration } from "@/lib/replayFormat";
import type {
  ReplayIndex,
  ReplayIndexEntry,
  ReplayPayload,
} from "@/lib/replayTypes";

export type {
  ReplayIndex,
  ReplayIndexEntry,
  ReplayPayload,
  ReplaySample,
  ReplayTrack,
} from "@/lib/replayTypes";
export { formatDuration };

function replaysDir(): string {
  return join(process.cwd(), "data", "replays");
}

export function listReplays(): ReplayIndexEntry[] {
  const indexPath = join(replaysDir(), "index.json");
  if (existsSync(indexPath)) {
    const idx = JSON.parse(readFileSync(indexPath, "utf-8")) as ReplayIndex;
    return idx.matches || [];
  }
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
