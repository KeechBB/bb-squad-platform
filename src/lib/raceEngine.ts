/**
 * Серверная физика «Карт-дуэль»: овальная трасса, 2 тачки, препятствия, круги.
 */

import { RACE_LAPS } from "@/lib/reaction";

export type RaceKeys = {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
};

export type RaceCar = {
  userId: string;
  x: number;
  y: number;
  angle: number;
  speed: number;
  lap: number;
  progress: number; // 0..1 along track + lap
  finished: boolean;
  color: string;
};

export type RaceObstacle = { x: number; y: number; r: number };

export type RaceTrack = {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  width: number;
  /** centerline samples */
  points: Array<{ x: number; y: number }>;
};

export type RaceState = {
  track: RaceTrack;
  obstacles: RaceObstacle[];
  cars: RaceCar[];
  tick: number;
  winnerUserId: string | null;
  startedAt: number;
};

function mulberry32(seed: number) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function buildTrack(seed: number): RaceTrack {
  const rnd = mulberry32(seed);
  const cx = 400;
  const cy = 300;
  const shape = Math.floor(rnd() * 4);
  let rx = 220 + rnd() * 40;
  let ry = 140 + rnd() * 40;
  if (shape === 1) {
    // circle
    ry = rx;
  } else if (shape === 2) {
    // wide stadium
    rx = 260;
    ry = 120;
  } else if (shape === 3) {
    // tall
    rx = 160;
    ry = 200;
  }
  const width = 52 + rnd() * 10;
  const points: Array<{ x: number; y: number }> = [];
  const N = 96;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    // mild wobble for "twisty" feel
    const wobble = 1 + (shape === 0 ? Math.sin(a * 3) * 0.06 * rnd() : 0);
    points.push({
      x: cx + Math.cos(a) * rx * wobble,
      y: cy + Math.sin(a) * ry * wobble,
    });
  }
  return { cx, cy, rx, ry, width, points };
}

function buildObstacles(seed: number, track: RaceTrack): RaceObstacle[] {
  const rnd = mulberry32(seed ^ 0x9e3779b9);
  const out: RaceObstacle[] = [];
  const count = 4 + Math.floor(rnd() * 5);
  for (let i = 0; i < count; i++) {
    const idx = Math.floor(rnd() * track.points.length);
    const p = track.points[idx]!;
    const a = Math.atan2(p.y - track.cy, p.x - track.cx);
    const side = rnd() < 0.5 ? -1 : 1;
    const dist = track.width * 0.15 + rnd() * track.width * 0.25;
    out.push({
      x: p.x + Math.cos(a + side * Math.PI / 2) * dist,
      y: p.y + Math.sin(a + side * Math.PI / 2) * dist,
      r: 10 + rnd() * 8,
    });
  }
  return out;
}

function nearestProgress(
  track: RaceTrack,
  x: number,
  y: number
): { idx: number; dist: number; t: number } {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < track.points.length; i++) {
    const p = track.points[i]!;
    const d = (p.x - x) ** 2 + (p.y - y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return {
    idx: best,
    dist: Math.sqrt(bestD),
    t: best / track.points.length,
  };
}

function startPose(track: RaceTrack, lane: number) {
  const p0 = track.points[0]!;
  const p1 = track.points[1]!;
  const angle = Math.atan2(p1.y - p0.y, p1.x - p0.x);
  const nx = Math.cos(angle + Math.PI / 2);
  const ny = Math.sin(angle + Math.PI / 2);
  const offset = lane === 0 ? -14 : 14;
  return {
    x: p0.x + nx * offset,
    y: p0.y + ny * offset,
    angle,
  };
}

export function createRaceState(
  seed: number,
  hostUserId: string,
  guestUserId: string
): RaceState {
  const track = buildTrack(seed);
  const obstacles = buildObstacles(seed, track);
  const a = startPose(track, 0);
  const b = startPose(track, 1);
  return {
    track,
    obstacles,
    cars: [
      {
        userId: hostUserId,
        x: a.x,
        y: a.y,
        angle: a.angle,
        speed: 0,
        lap: 0,
        progress: 0,
        finished: false,
        color: "#38bdf8",
      },
      {
        userId: guestUserId,
        x: b.x,
        y: b.y,
        angle: b.angle,
        speed: 0,
        lap: 0,
        progress: 0,
        finished: false,
        color: "#f472b6",
      },
    ],
    tick: 0,
    winnerUserId: null,
    startedAt: Date.now(),
  };
}

const ACCEL = 0.22;
const BRAKE = 0.28;
const FRICTION = 0.035;
const TURN = 0.055;
const MAX_SPEED = 5.2;
const CAR_R = 12;

function stepCar(
  car: RaceCar,
  keys: RaceKeys,
  track: RaceTrack,
  obstacles: RaceObstacle[],
  other: RaceCar | null,
  prevIdx: number
): { car: RaceCar; idx: number } {
  if (car.finished) return { car, idx: prevIdx };

  let { x, y, angle, speed, lap, progress } = car;

  if (keys.up) speed += ACCEL;
  if (keys.down) speed -= BRAKE;
  speed *= 1 - FRICTION;
  if (speed > MAX_SPEED) speed = MAX_SPEED;
  if (speed < -MAX_SPEED * 0.4) speed = -MAX_SPEED * 0.4;

  const steer = (keys.left ? -1 : 0) + (keys.right ? 1 : 0);
  if (Math.abs(speed) > 0.15) {
    angle += steer * TURN * Math.sign(speed || 1);
  }

  x += Math.cos(angle) * speed;
  y += Math.sin(angle) * speed;

  // keep near track ribbon
  const near = nearestProgress(track, x, y);
  const maxDist = track.width * 0.55;
  if (near.dist > maxDist) {
    const p = track.points[near.idx]!;
    const pull = (near.dist - maxDist) / near.dist;
    x -= (x - p.x) * pull * 0.85;
    y -= (y - p.y) * pull * 0.85;
    speed *= 0.55;
  }

  for (const o of obstacles) {
    const dx = x - o.x;
    const dy = y - o.y;
    const d = Math.hypot(dx, dy);
    const min = o.r + CAR_R;
    if (d > 0 && d < min) {
      const push = (min - d) / d;
      x += dx * push;
      y += dy * push;
      speed *= 0.4;
    }
  }

  if (other) {
    const dx = x - other.x;
    const dy = y - other.y;
    const d = Math.hypot(dx, dy);
    const min = CAR_R * 2;
    if (d > 0 && d < min) {
      const push = ((min - d) / d) * 0.5;
      x += dx * push;
      y += dy * push;
      speed *= 0.85;
    }
  }

  // lap detection: crossed start index forward
  let idx = near.idx;
  if (prevIdx > track.points.length * 0.75 && idx < track.points.length * 0.15) {
    lap += 1;
  }
  progress = lap + idx / track.points.length;
  const finished = lap >= RACE_LAPS;

  return {
    car: {
      ...car,
      x,
      y,
      angle,
      speed,
      lap: Math.min(lap, RACE_LAPS),
      progress,
      finished,
    },
    idx,
  };
}

export function tickRace(
  state: RaceState,
  inputs: Record<string, RaceKeys>,
  dtTicks = 1
): RaceState {
  if (state.winnerUserId) return state;
  let next: RaceState = { ...state, cars: state.cars.map((c) => ({ ...c })) };
  const idxMap = new Map<string, number>();
  for (const c of next.cars) {
    const near = nearestProgress(next.track, c.x, c.y);
    idxMap.set(c.userId, near.idx);
  }

  for (let t = 0; t < dtTicks; t++) {
    const cars = next.cars;
    const updated: RaceCar[] = [];
    for (let i = 0; i < cars.length; i++) {
      const car = cars[i]!;
      const other = cars.find((c) => c.userId !== car.userId) || null;
      const keys = inputs[car.userId] || {
        up: false,
        down: false,
        left: false,
        right: false,
      };
      const prevIdx = idxMap.get(car.userId) ?? 0;
      const stepped = stepCar(car, keys, next.track, next.obstacles, other, prevIdx);
      idxMap.set(car.userId, stepped.idx);
      updated.push(stepped.car);
    }
    next = {
      ...next,
      cars: updated,
      tick: next.tick + 1,
    };
    const finisher = updated.find((c) => c.finished);
    if (finisher) {
      next.winnerUserId = finisher.userId;
      break;
    }
  }
  return next;
}

export const EMPTY_KEYS: RaceKeys = {
  up: false,
  down: false,
  left: false,
  right: false,
};
