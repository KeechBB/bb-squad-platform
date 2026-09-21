/**
 * Серверная физика «Карт-дуэль»: именованные трассы Squad, военная техника.
 */

import { RACE_LAPS } from "@/lib/reaction";
import {
  pickRaceMap,
  pickVehicle,
  resampleClosedPath,
  type VehicleKind,
} from "@/lib/raceMaps";

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
  progress: number;
  finished: boolean;
  color: string;
  accent: string;
  vehicle: VehicleKind;
  vehicleLabel: string;
  maxSpeed: number;
  turn: number;
  accel: number;
};

export type RaceObstacle = {
  x: number;
  y: number;
  r: number;
  kind: "rubble" | "crate" | "wreck";
};

export type RaceTrack = {
  id: string;
  name: string;
  subtitle: string;
  cx: number;
  cy: number;
  width: number;
  ground: string;
  asphalt: string;
  line: string;
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

function buildTrackFromMap(seed: number): {
  track: RaceTrack;
  obstacles: RaceObstacle[];
} {
  const def = pickRaceMap(seed);
  const points = resampleClosedPath(def.control, 96);
  let cx = 0;
  let cy = 0;
  for (const p of points) {
    cx += p.x;
    cy += p.y;
  }
  cx /= points.length;
  cy /= points.length;

  const track: RaceTrack = {
    id: def.id,
    name: def.name,
    subtitle: def.subtitle,
    cx,
    cy,
    width: def.width,
    ground: def.ground,
    asphalt: def.asphalt,
    line: def.line,
    points,
  };

  const obstacles: RaceObstacle[] = def.obstacles.map((o) => {
    const idx = Math.floor(o.t * points.length) % points.length;
    const p = points[idx]!;
    const next = points[(idx + 1) % points.length]!;
    const ang = Math.atan2(next.y - p.y, next.x - p.x);
    const nx = Math.cos(ang + (o.side * Math.PI) / 2);
    const ny = Math.sin(ang + (o.side * Math.PI) / 2);
    return {
      x: p.x + nx * o.dist,
      y: p.y + ny * o.dist,
      r: o.r,
      kind: o.kind,
    };
  });

  return { track, obstacles };
}

function startPose(track: RaceTrack, lane: number, laneCount: number) {
  const p0 = track.points[0]!;
  const p1 = track.points[1]!;
  const angle = Math.atan2(p1.y - p0.y, p1.x - p0.x);
  const nx = Math.cos(angle + Math.PI / 2);
  const ny = Math.sin(angle + Math.PI / 2);
  const mid = (laneCount - 1) / 2;
  const offset = (lane - mid) * 16;
  return {
    x: p0.x + nx * offset,
    y: p0.y + ny * offset,
    angle,
  };
}

export function createRaceState(seed: number, playerIds: string[]): RaceState {
  const ids = playerIds.filter(Boolean);
  if (ids.length < 2) {
    throw new Error("Need at least 2 players");
  }
  const { track, obstacles } = buildTrackFromMap(seed);
  const cars: RaceCar[] = ids.map((userId, i) => {
    const pose = startPose(track, i, ids.length);
    const v = pickVehicle(i, seed);
    return {
      userId,
      x: pose.x,
      y: pose.y,
      angle: pose.angle,
      speed: 0,
      lap: 0,
      progress: 0,
      finished: false,
      color: v.color,
      accent: v.accent,
      vehicle: v.kind,
      vehicleLabel: v.label,
      maxSpeed: v.maxSpeed,
      turn: v.turn,
      accel: v.accel,
    };
  });
  return {
    track,
    obstacles,
    cars,
    tick: 0,
    winnerUserId: null,
    startedAt: Date.now(),
  };
}

const BRAKE = 0.28;
const FRICTION = 0.035;
const CAR_R = 12;

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

function stepCar(
  car: RaceCar,
  keys: RaceKeys,
  track: RaceTrack,
  obstacles: RaceObstacle[],
  others: RaceCar[],
  prevIdx: number
): { car: RaceCar; idx: number } {
  if (car.finished) return { car, idx: prevIdx };

  let { x, y, angle, speed, lap, progress } = car;

  if (keys.up) speed += car.accel;
  if (keys.down) speed -= BRAKE;
  speed *= 1 - FRICTION;
  if (speed > car.maxSpeed) speed = car.maxSpeed;
  if (speed < -car.maxSpeed * 0.4) speed = -car.maxSpeed * 0.4;

  const steer = (keys.left ? -1 : 0) + (keys.right ? 1 : 0);
  if (Math.abs(speed) > 0.15) {
    angle += steer * car.turn * Math.sign(speed || 1);
  }

  x += Math.cos(angle) * speed;
  y += Math.sin(angle) * speed;

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

  for (const other of others) {
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

  const idx = near.idx;
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
    const snapshot = next.cars.map((c) => ({ ...c }));
    const updated: RaceCar[] = [];
    for (const car of snapshot) {
      const others = snapshot.filter((c) => c.userId !== car.userId);
      const keys = inputs[car.userId] || {
        up: false,
        down: false,
        left: false,
        right: false,
      };
      const prevIdx = idxMap.get(car.userId) ?? 0;
      const stepped = stepCar(
        car,
        keys,
        next.track,
        next.obstacles,
        others,
        prevIdx
      );
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

/** Клиентский предикт своей тачки между снапшотами сервера */
export function predictMyCar(
  state: RaceState,
  myUserId: string,
  keys: RaceKeys,
  ticks: number
): RaceState {
  if (ticks <= 0 || state.winnerUserId) return state;
  let next: RaceState = { ...state, cars: state.cars.map((c) => ({ ...c })) };
  for (let t = 0; t < ticks; t++) {
    const me = next.cars.find((c) => c.userId === myUserId);
    if (!me || me.finished) break;
    const others = next.cars.filter((c) => c.userId !== myUserId);
    const prevIdx = nearestProgress(next.track, me.x, me.y).idx;
    const stepped = stepCar(
      me,
      keys,
      next.track,
      next.obstacles,
      others,
      prevIdx
    );
    next = {
      ...next,
      cars: next.cars.map((c) => (c.userId === myUserId ? stepped.car : c)),
    };
  }
  return next;
}

export const EMPTY_KEYS: RaceKeys = {
  up: false,
  down: false,
  left: false,
  right: false,
};
