/** План сетки Fruit Strike: 8 команд, двойное выбывание, 4 сервера. */

export const FRUIT_SERVERS = [
  "Blackberry #1",
  "FCL ARENA #3",
  "FCL ARENA #4",
  "FCL ARENA #5",
] as const;

const START_MS = Date.parse("2026-10-31T19:00:00+03:00");
const PLAY_MS = 40 * 60 * 1000;
const HOLD_MS = 60 * 60 * 1000;

/** Карточка: теги сторон + время. */
export const BRACKET_BOX = { w: 132, h: 62 };

const QX = 40;
const SX = 248;
const WX = 456;
const LX = 664;
const GX = 852;
/** Верхняя сетка — компактный блок сверху. */
const qfY = [36, 108, 220, 292];
const sfY = [72, 256];
const wfY = 164;
/** Гранд между сетками справа. */
const gfY = 372;
/** Сетка лузеров — отдельный блок ниже разделителя. */
const lbY = [488, 600];
const lsY = 544;
/** Высота SVG: нижний край lbY[1]+BRACKET_BOX.h + запас. */
export const BRACKET_VIEW = { w: 1000, h: 700 };
/** Y разделителя верхней сетки / сетки лузеров. */
export const BRACKET_SPLIT_Y = 400;

export type BracketLane = "upper" | "lower" | "final";

type RawMatch = {
  id: string;
  round: string;
  short: string;
  lane: BracketLane;
  x: number;
  y: number;
  needs: string[];
};

const RAW: RawMatch[] = [
  { id: "q1", round: "1/4 финала", short: "1/4", lane: "upper", x: QX, y: qfY[0], needs: [] },
  { id: "q2", round: "1/4 финала", short: "1/4", lane: "upper", x: QX, y: qfY[1], needs: [] },
  { id: "q3", round: "1/4 финала", short: "1/4", lane: "upper", x: QX, y: qfY[2], needs: [] },
  { id: "q4", round: "1/4 финала", short: "1/4", lane: "upper", x: QX, y: qfY[3], needs: [] },
  { id: "s1", round: "1/2 финала", short: "1/2", lane: "upper", x: SX, y: sfY[0], needs: ["q1", "q2"] },
  { id: "s2", round: "1/2 финала", short: "1/2", lane: "upper", x: SX, y: sfY[1], needs: ["q3", "q4"] },
  { id: "wf", round: "Финал верхней сетки", short: "Финал", lane: "upper", x: WX, y: wfY, needs: ["s1", "s2"] },
  { id: "l1", round: "Сетка лузеров · раунд 1", short: "Л·1", lane: "lower", x: QX, y: lbY[0], needs: ["q1", "q2"] },
  { id: "l2", round: "Сетка лузеров · раунд 1", short: "Л·1", lane: "lower", x: QX, y: lbY[1], needs: ["q3", "q4"] },
  { id: "r1", round: "Сетка лузеров · раунд 2", short: "Л·2", lane: "lower", x: SX, y: lbY[0], needs: ["l1", "s2"] },
  { id: "r2", round: "Сетка лузеров · раунд 2", short: "Л·2", lane: "lower", x: SX, y: lbY[1], needs: ["l2", "s1"] },
  { id: "ls", round: "1/2 сетки лузеров", short: "1/2 л", lane: "lower", x: WX, y: lsY, needs: ["r1", "r2"] },
  { id: "lf", round: "Финал сетки лузеров", short: "Финал л", lane: "lower", x: LX, y: lsY, needs: ["ls", "wf"] },
  { id: "gf", round: "Гранд-финал", short: "Гранд", lane: "final", x: GX, y: gfY, needs: ["wf", "lf"] },
];

export type PlannedMatch = RawMatch & {
  server: (typeof FRUIT_SERVERS)[number];
  startMs: number;
  playEndMs: number;
  freeMs: number;
  clock: string;
  when: string;
  until: string;
  freeAt: string;
};

function msk(ms: number, withDate: boolean): string {
  const clock = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Moscow",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(ms);
  if (!withDate) return clock;
  const date = new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    day: "2-digit",
    month: "2-digit",
  }).format(ms);
  return `${date} ${clock}`;
}

/** Сервер берётся из четырёх, как только он свободен. Матч стартует не раньше предшественников. */
export function planFruitStrike(): PlannedMatch[] {
  const freeAt = FRUIT_SERVERS.map(() => START_MS);
  const done = new Map<string, PlannedMatch>();
  const pending = [...RAW];
  const order = new Map(RAW.map((m, i) => [m.id, i]));

  while (pending.length) {
    const ready = pending.filter((m) => m.needs.every((id) => done.has(id)));
    if (!ready.length) break;
    ready.sort((a, b) => {
      const ta = a.needs.reduce((max, id) => Math.max(max, done.get(id)!.freeMs), START_MS);
      const tb = b.needs.reduce((max, id) => Math.max(max, done.get(id)!.freeMs), START_MS);
      return ta - tb || (order.get(a.id)! - order.get(b.id)!);
    });
    const match = ready[0]!;
    const readyMs = match.needs.reduce(
      (max, id) => Math.max(max, done.get(id)!.freeMs),
      START_MS,
    );
    let serverIdx = 0;
    for (let i = 1; i < freeAt.length; i += 1) {
      if (freeAt[i]! < freeAt[serverIdx]!) serverIdx = i;
    }
    const startMs = Math.max(readyMs, freeAt[serverIdx]!);
    const playEndMs = startMs + PLAY_MS;
    const freeMs = startMs + HOLD_MS;
    freeAt[serverIdx] = freeMs;
    const planned: PlannedMatch = {
      ...match,
      server: FRUIT_SERVERS[serverIdx]!,
      startMs,
      playEndMs,
      freeMs,
      clock: msk(startMs, false),
      when: msk(startMs, true),
      until: msk(playEndMs, true),
      freeAt: msk(freeMs, true),
    };
    done.set(match.id, planned);
    pending.splice(pending.indexOf(match), 1);
  }

  return RAW.map((m) => done.get(m.id)!);
}

export function nextOnServer(matches: PlannedMatch[], current: PlannedMatch): PlannedMatch | null {
  return (
    matches
      .filter((m) => m.server === current.server && m.startMs > current.startMs)
      .sort((a, b) => a.startMs - b.startMs)[0] ?? null
  );
}

export const FRUIT_STRIKE_PLAN = planFruitStrike();
