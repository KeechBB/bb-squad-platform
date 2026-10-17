/**
 * Replay map projection — single registry:
 * `data/replay-maps/registry.json`
 *
 * Tracks = world UU (cm) from .replay / squadreplay.
 * Image = Vanilla minimap from AllMaps pack (full res).
 * Bounds = SquadCalc SDK corners (metres × 100).
 */

import registryJson from "../../data/replay-maps/registry.json";

export type ReplayMapDef = {
  key: string;
  label: string;
  image: string;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  flipY?: boolean;
  boundsSource?: string;
};

type RegMap = {
  label: string;
  image: string;
  packPath?: string | null;
  boundsM: { minX: number; maxX: number; minY: number; maxY: number };
  flipY?: boolean;
  layers?: string[];
};

type Registry = {
  version: number;
  boundsSource: string;
  maps: Record<string, RegMap>;
};

const registry = registryJson as Registry;
const M = 100;

function toDef(key: string, meta: RegMap): ReplayMapDef {
  const b = meta.boundsM;
  return {
    key,
    label: meta.label,
    image: meta.image,
    minX: b.minX * M,
    maxX: b.maxX * M,
    minY: b.minY * M,
    maxY: b.maxY * M,
    // Squad world Y increases southward (= screen/texture Y down). Do not flip.
    flipY: meta.flipY === true,
    boundsSource: registry.boundsSource,
  };
}

export const REPLAY_MAPS: Record<string, ReplayMapDef> = Object.fromEntries(
  Object.entries(registry.maps).map(([k, v]) => [k, toDef(k, v)])
);

const LAYER_TO_KEY: Record<string, string> = {};
for (const [key, meta] of Object.entries(registry.maps)) {
  for (const layer of meta.layers || []) {
    LAYER_TO_KEY[layer.toLowerCase()] = key;
  }
}

/** Resolve map from explicit mapKey or layer / path fragment. */
export function resolveReplayMap(
  mapKey?: string | null,
  layer?: string | null
): ReplayMapDef | null {
  if (mapKey && REPLAY_MAPS[mapKey]) return REPLAY_MAPS[mapKey];

  const layerRaw = (layer || "").trim();
  if (!layerRaw) return null;

  const layerBase = layerRaw.includes("/")
    ? layerRaw.split("/").pop() || layerRaw
    : layerRaw;
  const hit = LAYER_TO_KEY[layerBase.toLowerCase()];
  if (hit) return REPLAY_MAPS[hit];

  const lower = layerRaw.toLowerCase();
  for (const [key, def] of Object.entries(REPLAY_MAPS)) {
    if (lower.includes(key.toLowerCase())) return def;
  }
  return null;
}

/** Infer registry mapKey for ingest / viewer.json. */
export function inferMapKeyFromLayer(layer: string): string | null {
  return resolveReplayMap(null, layer)?.key ?? null;
}

/** World UU → pixel on the full-resolution minimap texture. */
export function worldToMapPixel(
  x: number,
  y: number,
  map: ReplayMapDef,
  mapW: number,
  mapH: number
): { mx: number; my: number } {
  const u = (x - map.minX) / (map.maxX - map.minX);
  const vRaw = (y - map.minY) / (map.maxY - map.minY);
  const v = map.flipY === false ? vRaw : 1 - vRaw;
  return { mx: u * mapW, my: v * mapH };
}
