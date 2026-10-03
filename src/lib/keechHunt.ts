import { readFile } from "fs/promises";
import { join } from "path";
import { isBuiltinSuperAdmin } from "@/lib/admin";
import {
  KEECH_STEAM,
  openKeechHuntMatches,
  type KeechHuntLive,
  type KeechHuntMatch,
} from "@/lib/keechHuntTypes";

export {
  KEECH_STEAM,
  eventsForMatch,
  mergeKeechHuntEvents,
  openKeechHuntMatches,
  serverLabel,
  splitEvents,
  type KeechHuntEvent,
  type KeechHuntLive,
  type KeechHuntMatch,
} from "@/lib/keechHuntTypes";

function huntDir() {
  return join(process.cwd(), "data", "keech-hunt");
}

export function canAccessKeechHunt(steamId: string | null | undefined): boolean {
  return isBuiltinSuperAdmin(steamId);
}

export async function readKeechHuntLive(): Promise<KeechHuntLive> {
  try {
    const raw = await readFile(join(huntDir(), "live.json"), "utf8");
    return JSON.parse(raw) as KeechHuntLive;
  } catch {
    return {
      updatedAt: new Date().toISOString(),
      match: null,
      matches: [],
      keechSteam: KEECH_STEAM,
    };
  }
}

export async function readKeechHuntMemory(): Promise<KeechHuntMatch[]> {
  try {
    const raw = await readFile(join(huntDir(), "memory.json"), "utf8");
    const data = JSON.parse(raw) as { matches?: KeechHuntMatch[] };
    return Array.isArray(data.matches) ? data.matches : [];
  } catch {
    return [];
  }
}

export async function readKeechHuntMatch(
  id: string
): Promise<KeechHuntMatch | null> {
  const want = String(id || "").trim();
  if (!want) return null;
  const live = await readKeechHuntLive();
  for (const m of openKeechHuntMatches(live)) {
    if (m.id === want) return m;
  }
  if (live.match?.id === want) return live.match;
  const mem = await readKeechHuntMemory();
  return mem.find((m) => m.id === want) || null;
}
