import { FRUIT_MAP_BY_MATCH } from "@/lib/fruitStrikeBracket";

export const BET_POINTS = 100;

/** Момент, с которого прогноз уже не принимается: 18:59 МСК игрового дня. */
export function betClosesAt(playDate: string): Date {
  return new Date(`${playDate}T18:59:00+03:00`);
}

export function betsClosed(playDate: string, now = new Date()): boolean {
  return now.getTime() >= betClosesAt(playDate).getTime();
}

export type BetField =
  | "place1TeamId"
  | "place2TeamId"
  | "place3TeamId"
  | "topKillsUserId"
  | "topCutsUserId"
  | "lowKdTeamId"
  | "killsOver2000"
  | "cutsOver500"
  | "mostDeathsTeamId"
  | "topKillsMap"
  | "blowoutScore";

export type BetKind = "team" | "player" | "yn" | "map" | "score";

export type BetQuestion = {
  field: BetField;
  kind: BetKind;
  title: string;
  hint?: string;
  col: number;
  row: number;
};

export const BET_QUESTIONS: BetQuestion[] = [
  {
    field: "place1TeamId",
    kind: "team",
    title: "Команда, которая займёт первое место",
    col: 2,
    row: 1,
  },
  {
    field: "place2TeamId",
    kind: "team",
    title: "Команда, которая займёт второе место",
    col: 3,
    row: 1,
  },
  {
    field: "place3TeamId",
    kind: "team",
    title: "Команда, которая займёт третье место",
    col: 4,
    row: 1,
  },
  {
    field: "topKillsUserId",
    kind: "player",
    title: "Игрок, сделавший больше всего килов за турнир",
    col: 5,
    row: 1,
  },
  {
    field: "topCutsUserId",
    kind: "player",
    title: "Игрок, сделавший больше всего разрезов",
    col: 2,
    row: 2,
  },
  {
    field: "lowKdTeamId",
    kind: "team",
    title: "Команда с самым низким KD на команду",
    col: 3,
    row: 2,
  },
  {
    field: "killsOver2000",
    kind: "yn",
    title: "За время турнира будет суммарно больше 2000 убийств?",
    col: 4,
    row: 2,
  },
  {
    field: "cutsOver500",
    kind: "yn",
    title: "Дадут ли больше 500 разрезов?",
    col: 5,
    row: 2,
  },
  {
    field: "mostDeathsTeamId",
    kind: "team",
    title: "Команда, у которой будет больше всего смертей",
    col: 2,
    row: 3,
  },
  {
    field: "topKillsMap",
    kind: "map",
    title: "На какой карте будет больше всего убийств?",
    col: 3,
    row: 3,
  },
  {
    field: "blowoutScore",
    kind: "score",
    title: "Самый разгромный счёт раунда",
    hint: "Цифра тикетов, например 100-0",
    col: 4,
    row: 3,
  },
];

export type BetSlip = {
  place1TeamId: string;
  place2TeamId: string;
  place3TeamId: string;
  topKillsUserId: string;
  topCutsUserId: string;
  lowKdTeamId: string;
  killsOver2000: boolean | null;
  cutsOver500: boolean | null;
  mostDeathsTeamId: string;
  topKillsMap: string;
  blowoutScore: string;
};

export const EMPTY_BET_SLIP: BetSlip = {
  place1TeamId: "",
  place2TeamId: "",
  place3TeamId: "",
  topKillsUserId: "",
  topCutsUserId: "",
  lowKdTeamId: "",
  killsOver2000: null,
  cutsOver500: null,
  mostDeathsTeamId: "",
  topKillsMap: "",
  blowoutScore: "",
};

export type BetMapOption = { id: string; label: string };

export function betMapOptions(): BetMapOption[] {
  const seen = new Set<string>();
  const out: BetMapOption[] = [];
  for (const layer of Object.values(FRUIT_MAP_BY_MATCH)) {
    if (seen.has(layer)) continue;
    seen.add(layer);
    out.push({
      id: layer,
      label: layer.replace(/^FCL_/i, "").replace(/_/g, " "),
    });
  }
  return out;
}

/** Пустая строка — поле чистое. null — строка есть, но это не «100-0». */
export function normalizeBlowout(raw: string): string | null {
  const s = raw.trim().replace(/\s+/g, "").replace(/[–—:]/g, "-");
  if (!s) return "";
  const match = /^(\d{1,3})-(\d{1,3})$/.exec(s);
  if (!match) return null;
  return `${Number(match[1])}-${Number(match[2])}`;
}

/** Большее число слева: «0-100» и «100-0» — один и тот же разгром. */
export function blowoutKey(raw: string): string | null {
  const n = normalizeBlowout(raw);
  if (!n) return n;
  const [a, b] = n.split("-").map(Number);
  return `${Math.max(a, b)}-${Math.min(a, b)}`;
}

export function betPlacesClash(slip: BetSlip): boolean {
  const ids = [slip.place1TeamId, slip.place2TeamId, slip.place3TeamId].filter(Boolean);
  return new Set(ids).size !== ids.length;
}

/** Пустой ответ — null. false и «0-0» уже сданный прогноз. */
export function betAnswer(slip: BetSlip, field: BetField): string | boolean | null {
  const value = slip[field];
  if (value === "" || value === null) return null;
  return value;
}

export function betFilledCount(slip: BetSlip): number {
  return BET_QUESTIONS.filter((q) => {
    const value = slip[q.field];
    return value !== "" && value !== null;
  }).length;
}

export type BetPlayer = {
  userId: string;
  nick: string;
  href: string | null;
  slot: "STARTER" | "SUB";
};

export type BetTeam = {
  id: string;
  name: string;
  tag: string;
  logoUrl: string | null;
  seed: number;
  players: BetPlayer[];
};

export type BetBoardRow = {
  nick: string;
  href: string | null;
  /** Сколько вопросов человек уже сдал. Максимум — число вопросов бланка. */
  filled: number;
  correct: number;
  points: number;
  mine: boolean;
};

/** Реальные ответы после выявления чемпиона. Пока гранд-финал не сыгран — open: false. */
export type BetReveal = {
  open: boolean;
  champion: string | null;
  answers: Partial<BetSlip>;
  lines: Partial<Record<BetField, string>>;
};

export const BET_REVEAL_CLOSED: BetReveal = {
  open: false,
  champion: null,
  answers: {},
  lines: {},
};

export type BetsPayload = {
  locked: boolean;
  closesAt: string;
  authed: boolean;
  needsProfile: boolean;
  pointsEach: number;
  lockNote: string;
  tournamentName: string;
  graded: number;
  reveal: BetReveal;
  mine: BetSlip | null;
  board: BetBoardRow[];
  teams: BetTeam[];
  maps: BetMapOption[];
};

export function gradeBetSlip(
  slip: BetSlip,
  key: Partial<BetSlip> | null
): { correct: number; graded: number } {
  if (!key) return { correct: 0, graded: 0 };
  let correct = 0;
  let graded = 0;
  for (const q of BET_QUESTIONS) {
    const expected = key[q.field];
    if (expected === undefined || expected === null || expected === "") continue;
    graded += 1;
    const actual = slip[q.field];
    if (q.kind === "score") {
      const a = blowoutKey(String(actual ?? ""));
      const b = blowoutKey(String(expected ?? ""));
      if (a && b && a === b) correct += 1;
    } else if (actual === expected) {
      correct += 1;
    }
  }
  return { correct, graded };
}
