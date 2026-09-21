/** Тестовая трасса «Карт-дуэль»: один идеальный широкий круг, без препятствий */

export type VehicleKind = "mrap" | "tigr" | "atv" | "matv" | "logi" | "btr";

export type RaceMapDef = {
  id: string;
  name: string;
  subtitle: string;
  width: number;
  ground: string;
  asphalt: string;
  line: string;
  control: Array<{ x: number; y: number }>;
  obstacles: Array<{
    t: number;
    side: -1 | 1;
    dist: number;
    r: number;
    kind: "rubble" | "crate" | "wreck";
  }>;
};

/** Одинаковая динамика на время тестов синка */
const TEST_STATS = {
  maxSpeed: 5.2,
  turn: 0.055,
  accel: 0.22,
};

export const RACE_VEHICLES: Array<{
  kind: VehicleKind;
  label: string;
  color: string;
  accent: string;
  maxSpeed: number;
  turn: number;
  accel: number;
}> = [
  {
    kind: "mrap",
    label: "MRAP",
    color: "#4b5563",
    accent: "#9ca3af",
    ...TEST_STATS,
  },
  {
    kind: "tigr",
    label: "Тигр",
    color: "#3f6212",
    accent: "#a3e635",
    ...TEST_STATS,
  },
  {
    kind: "atv",
    label: "ATV",
    color: "#1e3a5f",
    accent: "#38bdf8",
    ...TEST_STATS,
  },
  {
    kind: "matv",
    label: "M-ATV",
    color: "#57534e",
    accent: "#d6d3d1",
    ...TEST_STATS,
  },
  {
    kind: "logi",
    label: "Logi",
    color: "#44403c",
    accent: "#fbbf24",
    ...TEST_STATS,
  },
  {
    kind: "btr",
    label: "БТР",
    color: "#365314",
    accent: "#84cc16",
    ...TEST_STATS,
  },
];

/** Идеальный круг по центру canvas 800×600 */
function perfectCircleControls(
  cx = 400,
  cy = 300,
  radius = 210,
  points = 48
): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < points; i++) {
    const a = (i / points) * Math.PI * 2 - Math.PI / 2;
    out.push({
      x: cx + Math.cos(a) * radius,
      y: cy + Math.sin(a) * radius,
    });
  }
  return out;
}

export const RACE_MAPS: RaceMapDef[] = [
  {
    id: "test-circle",
    name: "Тест-круг",
    subtitle: "синхрон · без препятствий",
    width: 78,
    ground: "#0f172a",
    asphalt: "#1e293b",
    line: "#94a3b8",
    control: perfectCircleControls(),
    obstacles: [],
  },
];

export function pickRaceMap(_seed: number): RaceMapDef {
  return RACE_MAPS[0]!;
}

export function pickVehicle(index: number, seed: number) {
  const start =
    Math.floor(Math.abs(seed) / Math.max(1, RACE_MAPS.length)) %
    RACE_VEHICLES.length;
  return RACE_VEHICLES[(start + index) % RACE_VEHICLES.length]!;
}

export function resampleClosedPath(
  control: Array<{ x: number; y: number }>,
  samples = 96
): Array<{ x: number; y: number }> {
  if (control.length < 3) return [...control];
  const ring = [...control, control[0]!];
  const segLens: number[] = [];
  let total = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const a = ring[i]!;
    const b = ring[i + 1]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    segLens.push(len);
    total += len;
  }
  const out: Array<{ x: number; y: number }> = [];
  for (let s = 0; s < samples; s++) {
    let dist = (s / samples) * total;
    let seg = 0;
    while (seg < segLens.length && dist > segLens[seg]!) {
      dist -= segLens[seg]!;
      seg += 1;
    }
    if (seg >= segLens.length) seg = segLens.length - 1;
    const a = ring[seg]!;
    const b = ring[seg + 1]!;
    const len = segLens[seg]! || 1;
    const t = dist / len;
    out.push({
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
    });
  }
  return out;
}
