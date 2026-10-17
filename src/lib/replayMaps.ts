/** World UU bounds for Squad minimap images (SquadCalc meters × 100). */

export type ReplayMapDef = {
  key: string;
  label: string;
  image: string;
  /** World AABB in Unreal units (cm). */
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  /**
   * Where the world AABB lands on the image (0–1 fractions).
   * Our PNG playable outline is inset vs full texture — calibrated for
   * `Карты 4098х4098/Готовые карты/Narva.png`.
   */
  uv?: { x0: number; y0: number; x1: number; y1: number };
  /** If true (default), image top = +Y (north). */
  flipY?: boolean;
};

const M = 100; // metres → Unreal units

export const REPLAY_MAPS: Record<string, ReplayMapDef> = {
  Narva: {
    key: "Narva",
    label: "Narva",
    image: "/replay-maps/Narva.jpg",
    // SquadCalc corners, slight pad so eastern/western mains sit inside grey FOW line
    minX: (-1390 - 80) * M,
    maxX: (1410 + 80) * M,
    minY: (-1402 - 80) * M,
    maxY: (1398 + 80) * M,
    // playable grey outline on our art is inset; stretch world into it
    uv: { x0: 0.045, y0: 0.035, x1: 0.905, y1: 0.955 },
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

/** World UU → canvas pixel. */
export function worldToPixel(
  x: number,
  y: number,
  map: ReplayMapDef,
  w: number,
  h: number
): { px: number; py: number } {
  const u = (x - map.minX) / (map.maxX - map.minX);
  const vRaw = (y - map.minY) / (map.maxY - map.minY);
  const v = map.flipY === false ? vRaw : 1 - vRaw;
  const x0 = map.uv?.x0 ?? 0;
  const y0 = map.uv?.y0 ?? 0;
  const x1 = map.uv?.x1 ?? 1;
  const y1 = map.uv?.y1 ?? 1;
  const px = (x0 + u * (x1 - x0)) * w;
  const py = (y0 + v * (y1 - y0)) * h;
  return { px, py };
}
