import { readFile } from "fs/promises";
import { join } from "path";
import { isBuiltinSuperAdmin } from "@/lib/admin";

export const KEECH_STEAM = "76561198028435874";

export type KeechHuntEvent = {
  id: string;
  kind: "kill" | "death" | "revive" | "self";
  at: string;
  time: string;
  nick: string;
  delta: number;
  oppWeight: number;
  bones?: Record<string, number>;
  server?: string;
};

export type KeechHuntMatch = {
  id: string;
  server: string;
  layer: string;
  layerShort: string;
  startAt: string;
  endAt: string | null;
  events: KeechHuntEvent[];
  net: number;
  kills: number;
  deaths: number;
  revives: number;
};

export type KeechHuntLive = {
  updatedAt: string;
  match: KeechHuntMatch | null;
  keechSteam: string;
};

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
  if (live.match?.id === want) return live.match;
  const mem = await readKeechHuntMemory();
  return mem.find((m) => m.id === want) || null;
}

export function splitEvents(events: KeechHuntEvent[]) {
  const kills = events.filter((e) => e.kind === "kill");
  const deaths = events.filter((e) => e.kind === "death" || e.kind === "self");
  const revives = events.filter((e) => e.kind === "revive");
  return { kills, deaths, revives };
}
