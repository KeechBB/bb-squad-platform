/**
 * Сетка Fruit Strike #01: 8 команд, двойное выбывание.
 * Посев — по порядку подачи заявки (1…8). Пара 1–8 / 4–5 / 2–7 / 3–6.
 * Победа в матче — по сумме тикетов R1+R2 (не по числу раундов).
 */

export type FruitTeam = {
  name: string;
  tag: string;
};

/** Порядок регистрации (seed 1 → 8). */
export const FRUIT_TEAMS_SEEDED: FruitTeam[] = [
  { name: "SUNRISE", tag: "SR" },
  { name: "PHOENIX AMETHYST", tag: "PA" },
  { name: "PHOENIX", tag: "PX" },
  { name: "PHOENIX SKY MIST", tag: "PSM" },
  { name: "DANON", tag: "DN" },
  { name: "ALPHA", tag: "A" },
  { name: "Ritual Agency", tag: "RA" },
  { name: "EMERGENCY", tag: "BBEG" },
];

const S = FRUIT_TEAMS_SEEDED;

/** 1/4: классический посев. */
export const FRUIT_QF: Record<
  "q1" | "q2" | "q3" | "q4",
  { a: FruitTeam; b: FruitTeam }
> = {
  q1: { a: S[0]!, b: S[7]! }, // 1 vs 8
  q2: { a: S[3]!, b: S[4]! }, // 4 vs 5
  q3: { a: S[1]!, b: S[6]! }, // 2 vs 7
  q4: { a: S[2]!, b: S[5]! }, // 3 vs 6
};

/** Карты FCL 8×8 — по одной на каждый матч сетки (14 = 14). */
export const FRUIT_MAP_BY_MATCH: Record<string, string> = {
  q1: "FCL_AlBasrah_v1",
  q2: "FCL_BlackCoast_v1",
  q3: "FCL_Fallujah_v1",
  q4: "FCL_GooseBay_v1",
  s1: "FCL_Harju_v1",
  s2: "FCL_Kamdesh_v1",
  wf: "FCL_Kokan_v1",
  l1: "FCL_Lashkar_v1",
  l2: "FCL_Mutaha_v1",
  r1: "FCL_Mutaha_v2",
  r2: "FCL_Narva_v1",
  ls: "FCL_Narva_v2",
  lf: "FCL_Sanxian_v1",
  gf: "FCL_Sumari_v1",
};

export const FRUIT_FACTION_LEFT = "USA";
export const FRUIT_FACTION_RIGHT = "RGF";

export type FruitSideSlot =
  | { kind: "team"; team: FruitTeam }
  | { kind: "tbd"; label: string; short: string };

export type FruitMatchBrief = {
  id: string;
  map: string;
  mapShort: string;
  left: FruitSideSlot;
  right: FruitSideSlot;
  factionLeft: typeof FRUIT_FACTION_LEFT;
  factionRight: typeof FRUIT_FACTION_RIGHT;
  /** Подпись формата для модалки */
  formatNote: string;
};

function mapShort(layer: string): string {
  return layer
    .replace(/^FCL_/i, "")
    .replace(/_/g, " ");
}

function teamSlot(t: FruitTeam): FruitSideSlot {
  return { kind: "team", team: t };
}

function tbd(label: string, short: string): FruitSideSlot {
  return { kind: "tbd", label, short };
}

const FORMAT_NOTE =
  "2 раунда (R1 + R2) · победа по сумме тикетов · слева USA · справа RGF";

/** Слоты сторон на матч (до старта — TBD дальше 1/4). */
export function fruitMatchBrief(id: string): FruitMatchBrief {
  const map = FRUIT_MAP_BY_MATCH[id] || "FCL_TBA_v1";
  const base = {
    id,
    map,
    mapShort: mapShort(map),
    factionLeft: FRUIT_FACTION_LEFT,
    factionRight: FRUIT_FACTION_RIGHT,
    formatNote: FORMAT_NOTE,
  } as const;

  if (id === "q1" || id === "q2" || id === "q3" || id === "q4") {
    const pair = FRUIT_QF[id];
    return { ...base, left: teamSlot(pair.a), right: teamSlot(pair.b) };
  }

  const later: Record<string, { left: FruitSideSlot; right: FruitSideSlot }> = {
    s1: {
      left: tbd("Победитель 1/4 · q1", "W·q1"),
      right: tbd("Победитель 1/4 · q2", "W·q2"),
    },
    s2: {
      left: tbd("Победитель 1/4 · q3", "W·q3"),
      right: tbd("Победитель 1/4 · q4", "W·q4"),
    },
    wf: {
      left: tbd("Победитель 1/2 · s1", "W·s1"),
      right: tbd("Победитель 1/2 · s2", "W·s2"),
    },
    l1: {
      left: tbd("Проигравший 1/4 · q1", "L·q1"),
      right: tbd("Проигравший 1/4 · q2", "L·q2"),
    },
    l2: {
      left: tbd("Проигравший 1/4 · q3", "L·q3"),
      right: tbd("Проигравший 1/4 · q4", "L·q4"),
    },
    r1: {
      left: tbd("Победитель Л·1 · l1", "W·l1"),
      right: tbd("Проигравший 1/2 · s2", "L·s2"),
    },
    r2: {
      left: tbd("Победитель Л·1 · l2", "W·l2"),
      right: tbd("Проигравший 1/2 · s1", "L·s1"),
    },
    ls: {
      left: tbd("Победитель Л·2 · r1", "W·r1"),
      right: tbd("Победитель Л·2 · r2", "W·r2"),
    },
    lf: {
      left: tbd("Победитель 1/2 л · ls", "W·ls"),
      right: tbd("Проигравший финала верхней", "L·wf"),
    },
    gf: {
      left: tbd("Чемпион верхней сетки", "W·wf"),
      right: tbd("Чемпион сетки лузеров", "W·lf"),
    },
  };

  const sides = later[id] || {
    left: tbd("TBD", "TBD"),
    right: tbd("TBD", "TBD"),
  };
  return { ...base, ...sides };
}

export function sideCardLabel(slot: FruitSideSlot): string {
  if (slot.kind === "team") return slot.team.tag;
  return slot.short;
}

export function sideFullLabel(slot: FruitSideSlot): string {
  if (slot.kind === "team") return `${slot.team.name} [${slot.team.tag}]`;
  return slot.label;
}
