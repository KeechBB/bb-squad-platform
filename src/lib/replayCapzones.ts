/**
 * Static capture zones / mains for replay overlay.
 * Source: squadreader data/static/capzones.json (slimmed).
 */
import capzonesJson from "../../data/replay-maps/capzones.json";

export type ReplayCapzone = {
  name: string;
  cluster: string;
  x: number;
  y: number;
};

const byLayer = capzonesJson as Record<string, ReplayCapzone[]>;

/** Resolve caps for a layer id like Narva_AAS_v1 or display "Narva AAS v1". */
export function resolveReplayCapzones(layer?: string | null): ReplayCapzone[] {
  if (!layer) return [];
  const raw = layer.trim();
  const underscored = raw.includes("/")
    ? (raw.split("/").pop() || raw)
    : raw;
  const key = underscored.replace(/\s+/g, "_");
  if (byLayer[key]) return byLayer[key];
  const spaced = key.replace(/_/g, " ");
  for (const [k, v] of Object.entries(byLayer)) {
    if (k.replace(/_/g, " ").toLowerCase() === spaced.toLowerCase()) return v;
  }
  return [];
}
