/** World UU bounds for Squad minimap images (SquadCalc meters × 100). */

export type ReplayMapDef = {
  key: string;
  label: string;
  image: string;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

const M = 100; // metres → Unreal units

export const REPLAY_MAPS: Record<string, ReplayMapDef> = {
  Narva: {
    key: "Narva",
    label: "Narva",
    image: "/replay-maps/Narva.jpg",
    minX: -1390 * M,
    maxX: 1410 * M,
    minY: -1402 * M,
    maxY: 1398 * M,
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

/** World UU → canvas pixel. Image top = +Y (north). */
export function worldToPixel(
  x: number,
  y: number,
  map: ReplayMapDef,
  w: number,
  h: number
): { px: number; py: number } {
  const px = ((x - map.minX) / (map.maxX - map.minX)) * w;
  const py = ((map.maxY - y) / (map.maxY - map.minY)) * h;
  return { px, py };
}
