/** Именованные трассы «Карт-дуэль» — антураж карт Squad */

export type VehicleKind = "mrap" | "tigr" | "atv" | "matv" | "logi" | "btr";

export type RaceMapDef = {
  id: string;
  /** Короткое имя для HUD */
  name: string;
  /** Подзаголовок */
  subtitle: string;
  width: number;
  ground: string;
  asphalt: string;
  line: string;
  /** Контрольные точки замкнутого контура (canvas 800×600) */
  control: Array<{ x: number; y: number }>;
  /** Препятствия: t ∈ [0..1) вдоль трассы, side ±1, dist от центра */
  obstacles: Array<{
    t: number;
    side: -1 | 1;
    dist: number;
    r: number;
    kind: "rubble" | "crate" | "wreck";
  }>;
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
    maxSpeed: 4.7,
    turn: 0.042,
    accel: 0.18,
  },
  {
    kind: "tigr",
    label: "Тигр",
    color: "#3f6212",
    accent: "#a3e635",
    maxSpeed: 5.15,
    turn: 0.052,
    accel: 0.21,
  },
  {
    kind: "atv",
    label: "ATV",
    color: "#1e3a5f",
    accent: "#38bdf8",
    maxSpeed: 5.55,
    turn: 0.068,
    accel: 0.26,
  },
  {
    kind: "matv",
    label: "M-ATV",
    color: "#57534e",
    accent: "#d6d3d1",
    maxSpeed: 5.0,
    turn: 0.048,
    accel: 0.2,
  },
  {
    kind: "logi",
    label: "Logi",
    color: "#44403c",
    accent: "#fbbf24",
    maxSpeed: 4.4,
    turn: 0.038,
    accel: 0.16,
  },
  {
    kind: "btr",
    label: "БТР",
    color: "#365314",
    accent: "#84cc16",
    maxSpeed: 4.9,
    turn: 0.045,
    accel: 0.19,
  },
];

export const RACE_MAPS: RaceMapDef[] = [
  {
    id: "narva",
    name: "Нарва",
    subtitle: "Кольцо Старого города",
    width: 54,
    ground: "#1a2332",
    asphalt: "#2a3344",
    line: "#94a3b8",
    control: [
      { x: 220, y: 180 },
      { x: 400, y: 140 },
      { x: 580, y: 180 },
      { x: 640, y: 300 },
      { x: 580, y: 420 },
      { x: 400, y: 460 },
      { x: 220, y: 420 },
      { x: 160, y: 300 },
    ],
    obstacles: [
      { t: 0.12, side: 1, dist: 18, r: 11, kind: "rubble" },
      { t: 0.28, side: -1, dist: 16, r: 10, kind: "crate" },
      { t: 0.45, side: 1, dist: 20, r: 12, kind: "wreck" },
      { t: 0.62, side: -1, dist: 15, r: 9, kind: "rubble" },
      { t: 0.8, side: 1, dist: 17, r: 11, kind: "crate" },
    ],
  },
  {
    id: "fallujah",
    name: "Фаллуджа",
    subtitle: "Медина",
    width: 48,
    ground: "#2a2118",
    asphalt: "#3d3428",
    line: "#d6c6a8",
    control: [
      { x: 260, y: 200 },
      { x: 400, y: 150 },
      { x: 540, y: 200 },
      { x: 590, y: 300 },
      { x: 540, y: 400 },
      { x: 400, y: 450 },
      { x: 260, y: 400 },
      { x: 210, y: 300 },
    ],
    obstacles: [
      { t: 0.08, side: -1, dist: 14, r: 10, kind: "rubble" },
      { t: 0.18, side: 1, dist: 15, r: 11, kind: "rubble" },
      { t: 0.32, side: -1, dist: 16, r: 12, kind: "wreck" },
      { t: 0.48, side: 1, dist: 14, r: 9, kind: "crate" },
      { t: 0.58, side: -1, dist: 17, r: 11, kind: "rubble" },
      { t: 0.72, side: 1, dist: 15, r: 10, kind: "crate" },
      { t: 0.88, side: -1, dist: 16, r: 12, kind: "wreck" },
    ],
  },
  {
    id: "goose-bay",
    name: "Goose Bay",
    subtitle: "Тундра",
    width: 60,
    ground: "#152028",
    asphalt: "#243040",
    line: "#7dd3fc",
    control: [
      { x: 180, y: 260 },
      { x: 320, y: 140 },
      { x: 520, y: 130 },
      { x: 660, y: 250 },
      { x: 640, y: 380 },
      { x: 480, y: 470 },
      { x: 280, y: 460 },
      { x: 160, y: 360 },
    ],
    obstacles: [
      { t: 0.2, side: 1, dist: 22, r: 13, kind: "rubble" },
      { t: 0.4, side: -1, dist: 20, r: 12, kind: "rubble" },
      { t: 0.65, side: 1, dist: 21, r: 14, kind: "wreck" },
      { t: 0.85, side: -1, dist: 19, r: 11, kind: "crate" },
    ],
  },
  {
    id: "manicouagan",
    name: "Маникуаган",
    subtitle: "Кратер",
    width: 58,
    ground: "#14241c",
    asphalt: "#1f3328",
    line: "#86efac",
    control: [
      { x: 400, y: 120 },
      { x: 560, y: 170 },
      { x: 640, y: 300 },
      { x: 560, y: 430 },
      { x: 400, y: 480 },
      { x: 240, y: 430 },
      { x: 160, y: 300 },
      { x: 240, y: 170 },
    ],
    obstacles: [
      { t: 0.15, side: 1, dist: 20, r: 12, kind: "rubble" },
      { t: 0.35, side: -1, dist: 18, r: 11, kind: "crate" },
      { t: 0.55, side: 1, dist: 22, r: 13, kind: "wreck" },
      { t: 0.75, side: -1, dist: 19, r: 10, kind: "rubble" },
      { t: 0.92, side: 1, dist: 17, r: 11, kind: "crate" },
    ],
  },
  {
    id: "al-basrah",
    name: "Аль-Басра",
    subtitle: "Каналы",
    width: 52,
    ground: "#2c2416",
    asphalt: "#3a3220",
    line: "#fcd34d",
    control: [
      { x: 140, y: 280 },
      { x: 220, y: 160 },
      { x: 400, y: 130 },
      { x: 600, y: 160 },
      { x: 680, y: 280 },
      { x: 620, y: 400 },
      { x: 400, y: 460 },
      { x: 180, y: 400 },
    ],
    obstacles: [
      { t: 0.1, side: -1, dist: 16, r: 10, kind: "crate" },
      { t: 0.25, side: 1, dist: 18, r: 11, kind: "rubble" },
      { t: 0.42, side: -1, dist: 15, r: 12, kind: "wreck" },
      { t: 0.58, side: 1, dist: 17, r: 10, kind: "crate" },
      { t: 0.78, side: -1, dist: 19, r: 13, kind: "rubble" },
    ],
  },
  {
    id: "harju",
    name: "Харю",
    subtitle: "Лесной серпантин",
    width: 50,
    ground: "#16241a",
    asphalt: "#223528",
    line: "#bbf7d0",
    control: [
      { x: 200, y: 220 },
      { x: 320, y: 130 },
      { x: 480, y: 160 },
      { x: 620, y: 220 },
      { x: 650, y: 340 },
      { x: 520, y: 450 },
      { x: 340, y: 470 },
      { x: 180, y: 380 },
      { x: 150, y: 280 },
    ],
    obstacles: [
      { t: 0.14, side: 1, dist: 15, r: 10, kind: "rubble" },
      { t: 0.3, side: -1, dist: 16, r: 11, kind: "crate" },
      { t: 0.46, side: 1, dist: 14, r: 9, kind: "rubble" },
      { t: 0.6, side: -1, dist: 18, r: 12, kind: "wreck" },
      { t: 0.76, side: 1, dist: 15, r: 10, kind: "crate" },
      { t: 0.9, side: -1, dist: 16, r: 11, kind: "rubble" },
    ],
  },
];

export function pickRaceMap(seed: number): RaceMapDef {
  const i = ((seed % RACE_MAPS.length) + RACE_MAPS.length) % RACE_MAPS.length;
  return RACE_MAPS[i]!;
}

export function pickVehicle(index: number, seed: number) {
  const start =
    Math.floor(Math.abs(seed) / RACE_MAPS.length) % RACE_VEHICLES.length;
  return RACE_VEHICLES[(start + index) % RACE_VEHICLES.length]!;
}

/** Равномерно вдоль замкнутого контура */
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
