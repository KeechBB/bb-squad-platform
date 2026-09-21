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

/** Поза с клиента — чтобы соперники видели актуальную позицию, а не отстающий симулятор */
export type RacePose = {
  x: number;
  y: number;
  angle: number;
  speed: number;
  lap: number;
  progress: number;
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

/** Наложить свежие клиентские позы (соперник видит тебя без «пинга») */
export function applyClientPoses(
  state: RaceState,
  inputs: Record<string, RaceKeys & { pose?: RacePose; at?: number }>,
  now = Date.now(),
  maxAgeMs = 600
): RaceState {
  if (state.winnerUserId) return state;
  const cars = state.cars.map((car) => {
    const inp = inputs[car.userId];
    const pose = inp?.pose;
    const at = inp?.at;
    if (!pose || typeof at !== "number" || now - at > maxAgeMs) return car;
    if (
      ![pose.x, pose.y, pose.angle, pose.speed, pose.progress].every((n) =>
        Number.isFinite(n)
      )
    ) {
      return car;
    }
    const err = Math.hypot(car.x - pose.x, car.y - pose.y);
    // на тесте синка разрешаем большой зазор — иначе поза отбрасывается
    if (err > 480) return car;
    const lap = Math.max(
      car.lap,
      Math.max(0, Math.min(RACE_LAPS, Math.floor(pose.lap) || 0))
    );
    const progress = Math.max(car.progress, pose.progress);
    const finished = car.finished || lap >= RACE_LAPS;
    return {
      ...car,
      x: pose.x,
      y: pose.y,
      angle: pose.angle,
      speed: pose.speed,
      lap,
      progress,
      finished,
    };
  });
  let winnerUserId = state.winnerUserId;
  if (!winnerUserId) {
    const fin = cars.find((c) => c.finished);
    if (fin) winnerUserId = fin.userId;
  }
  return { ...state, cars, winnerUserId };
}

/** Чужие тачки чуть «плывут» между снапшотами */
export function coastOtherCars(
  state: RaceState,
  myUserId: string,
  dtSec: number
): RaceState {
  if (dtSec <= 0 || state.winnerUserId) return state;
  const t = Math.min(0.05, dtSec);
  return {
    ...state,
    cars: state.cars.map((car) => {
      if (car.userId === myUserId || car.finished) return car;
      const speed = car.speed * 0.98;
      return {
        ...car,
        x: car.x + Math.cos(car.angle) * speed * t * 60,
        y: car.y + Math.sin(car.angle) * speed * t * 60,
        speed,
      };
    }),
  };
}

/** Свести локальный кадр с сервером: свою тачку не откатываем назад. */
export function reconcileRaceState(
  local: RaceState,
  server: RaceState,
  myUserId: string
): RaceState {
  const localMe = local.cars.find((c) => c.userId === myUserId);
  const serverIds = new Set(server.cars.map((c) => c.userId));

  const cars: RaceCar[] = server.cars.map((sc) => {
    if (sc.userId !== myUserId) {
      // Соперник — почти сразу на его клиентскую позу (синхрон)
      const prev = local.cars.find((c) => c.userId === sc.userId);
      if (!prev) return { ...sc };
      const t = 0.75;
      return {
        ...sc,
        x: prev.x + (sc.x - prev.x) * t,
        y: prev.y + (sc.y - prev.y) * t,
        angle: prev.angle + (sc.angle - prev.angle) * t,
        speed: prev.speed + (sc.speed - prev.speed) * t,
      };
    }

    // Своя тачка: отображение всегда с клиента.
    // Сервер может отставать на RTT — откат назад = «пинг 1000».
    if (!localMe) return { ...sc };

    return {
      ...localMe,
      // серверные флаги финиша/круга только если он впереди (мы отстали)
      lap: Math.max(localMe.lap, sc.lap),
      progress: Math.max(localMe.progress, sc.progress),
      finished: localMe.finished || sc.finished,
      // косметика с сервера
      color: sc.color || localMe.color,
      accent: sc.accent || localMe.accent,
      vehicle: sc.vehicle || localMe.vehicle,
      vehicleLabel: sc.vehicleLabel || localMe.vehicleLabel,
    };
  });

  // на всякий случай, если локальная тачка пропала из server.cars
  if (localMe && !serverIds.has(myUserId)) {
    cars.push({ ...localMe });
  }

  return {
    ...server,
    cars,
    winnerUserId: server.winnerUserId,
    startedAt: server.startedAt || local.startedAt,
    tick: Math.max(local.tick, server.tick),
  };
}

export const EMPTY_KEYS: RaceKeys = {
  up: false,
  down: false,
  left: false,
  right: false,
};
