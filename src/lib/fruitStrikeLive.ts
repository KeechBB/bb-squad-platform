/**
 * Live Fruit Strike bracket state written by sync_tournament_from_tr_logs.py
 * Server-only loader — view helpers live in fruitStrikeLiveView.ts (client-safe).
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import type { FruitLiveState } from "@/lib/fruitStrikeLiveView";

export type {
  FruitLiveTeam,
  FruitLiveRound,
  FruitLiveMatch,
  FruitLiveState,
} from "@/lib/fruitStrikeLiveView";

const LIVE_REL = path.join("data", "tournaments", "fruit-strike-s1-live.json");

export async function loadFruitStrikeLive(): Promise<FruitLiveState | null> {
  try {
    const full = path.join(process.cwd(), LIVE_REL);
    const raw = await fs.readFile(full, "utf8");
    return JSON.parse(raw) as FruitLiveState;
  } catch {
    return null;
  }
}
