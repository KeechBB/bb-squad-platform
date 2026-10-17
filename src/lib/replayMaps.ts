/** World UU ↔ official Squad minimap (SquadCalc / SDK corners). */

export type ReplayMapDef = {
  key: string;
  label: string;
  /** Full-resolution minimap under /public (no recompress). */
  image: string;
  /** World AABB in Unreal units (cm) = SquadCalc metres × 100. */
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  /** If true (default), image top = +Y (north). */
  flipY?: boolean;
};

const M = 100; // metres → Unreal units

/**
 * Bounds from SquadCalc SDK minimap corners (metres).
 * Image: Vanilla `Narva_Minimap.PNG` from AllMaps_Minimaps — full frame = these corners.
 */
export const REPLAY_MAPS: Record<string, ReplayMapDef> = {
  Narva: {
    key: "Narva",
    label: "Narva",
    image: "/replay-maps/Narva.png",
    minX: -1390 * M,
    maxX: 1410 * M,
    minY: -1402 * M,
    maxY: 1398 * M,
    flipY: true,
  },
};

export function resolveReplayMap(mapKey?: string | null, layer?: string | null): ReplayMapDef | null {
  if (mapKey && REPLAY_MAPS[mapKey]) return REPLAY_MAPS[mapKey];
  const layerLower = (layer || "").toLowerCase();
  for (const m of Object.values(REPLAY_MAPS)) {
    if (layerLower.includes(m.key.toLowerCase())) return m;
  }
  return null;
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
