"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { RACE_LAPS, RACE_RATING_START } from "@/lib/reaction";
import {
  predictMyCar,
  reconcileRaceState,
  type RaceCar,
  type RaceObstacle,
  type RaceState,
} from "@/lib/raceEngine";
import type { VehicleKind } from "@/lib/raceMaps";

type RatingEntry = {
  userId: string;
  before: number;
  delta: number;
  after: number;
};

type RoomView = {
  id: string;
  status: string;
  seed: number;
  capacity: 2 | 3;
  hostUserId: string;
  guestUserId: string | null;
  guest2UserId: string | null;
  playerIds: string[];
  winnerUserId: string | null;
  countdownEndsAt: string | null;
  youAreHost: boolean;
  state: RaceState | null;
  ratingResult: {
    entries?: RatingEntry[];
    beforeHost?: number;
    beforeGuest?: number;
    deltaHost?: number;
    deltaGuest?: number;
    afterHost?: number;
    afterGuest?: number;
  } | null;
};

type Peer = { userId?: string; nick: string; raceRating: number };

type Keys = { up: boolean; down: boolean; left: boolean; right: boolean };

const EMPTY: Keys = { up: false, down: false, left: false, right: false };

function drawObstacle(ctx: CanvasRenderingContext2D, o: RaceObstacle) {
  if (o.kind === "crate") {
    ctx.fillStyle = "#92400e";
    ctx.fillRect(o.x - o.r * 0.85, o.y - o.r * 0.85, o.r * 1.7, o.r * 1.7);
    ctx.strokeStyle = "#78350f";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(o.x - o.r * 0.85, o.y - o.r * 0.85, o.r * 1.7, o.r * 1.7);
    return;
  }
  if (o.kind === "wreck") {
    ctx.fillStyle = "#3f3f46";
    ctx.beginPath();
    ctx.ellipse(o.x, o.y, o.r * 1.2, o.r * 0.7, 0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#71717a";
    ctx.fillRect(o.x - o.r * 0.4, o.y - o.r * 0.9, o.r * 0.8, o.r * 0.5);
    return;
  }
  ctx.fillStyle = "#78716c";
  ctx.beginPath();
  ctx.arc(o.x, o.y, o.r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#57534e";
  ctx.beginPath();
  ctx.arc(o.x - o.r * 0.3, o.y - o.r * 0.2, o.r * 0.45, 0, Math.PI * 2);
  ctx.fill();
}

function drawVehicle(
  ctx: CanvasRenderingContext2D,
  car: RaceCar,
  mine: boolean
) {
  const kind: VehicleKind = car.vehicle || "mrap";
  ctx.save();
  ctx.translate(car.x, car.y);
  ctx.rotate(car.angle);

  if (mine) {
    ctx.strokeStyle = "#fef08a";
    ctx.lineWidth = 3;
    ctx.strokeRect(-19, -13, 38, 26);
  }

  ctx.fillStyle = car.color || "#4b5563";
  ctx.strokeStyle = car.accent || "#9ca3af";
  ctx.lineWidth = 1.5;

  if (kind === "atv") {
    ctx.fillRect(-12, -7, 24, 14);
    ctx.fillStyle = "#0f172a";
    ctx.beginPath();
    ctx.arc(-8, -8, 4, 0, Math.PI * 2);
    ctx.arc(-8, 8, 4, 0, Math.PI * 2);
    ctx.arc(9, -8, 4, 0, Math.PI * 2);
    ctx.arc(9, 8, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = car.accent;
    ctx.fillRect(4, -4, 8, 8);
  } else if (kind === "logi") {
    ctx.fillRect(-18, -9, 36, 18);
    ctx.fillStyle = "#1c1917";
    ctx.fillRect(8, -7, 10, 14);
    ctx.fillStyle = car.accent;
    ctx.fillRect(-16, -7, 18, 14);
    ctx.strokeRect(-18, -9, 36, 18);
  } else if (kind === "btr") {
    ctx.beginPath();
    ctx.moveTo(-16, -8);
    ctx.lineTo(14, -9);
    ctx.lineTo(18, 0);
    ctx.lineTo(14, 9);
    ctx.lineTo(-16, 8);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = car.accent;
    ctx.beginPath();
    ctx.arc(2, 0, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#14532d";
    ctx.fillRect(2, -2, 14, 4);
  } else if (kind === "tigr") {
    ctx.fillRect(-15, -9, 30, 18);
    ctx.fillStyle = "#14532d";
    ctx.fillRect(2, -7, 12, 14);
    ctx.fillStyle = car.accent;
    ctx.fillRect(-12, -6, 10, 12);
    ctx.strokeRect(-15, -9, 30, 18);
  } else if (kind === "matv") {
    ctx.fillRect(-16, -10, 32, 20);
    ctx.fillStyle = "#292524";
    ctx.fillRect(0, -8, 14, 16);
    ctx.fillStyle = car.accent;
    ctx.fillRect(-13, -7, 10, 14);
    ctx.fillStyle = "#a8a29e";
    ctx.fillRect(4, -3, 12, 6);
  } else {
    ctx.fillRect(-17, -11, 34, 22);
    ctx.fillStyle = "#1f2937";
    ctx.fillRect(0, -9, 15, 18);
    ctx.fillStyle = car.accent;
    ctx.fillRect(-14, -8, 11, 16);
    ctx.strokeRect(-17, -11, 34, 22);
    ctx.strokeStyle = "#111827";
    ctx.beginPath();
    ctx.moveTo(2, -6);
    ctx.lineTo(12, -6);
    ctx.moveTo(2, 0);
    ctx.lineTo(12, 0);
    ctx.moveTo(2, 6);
    ctx.lineTo(12, 6);
    ctx.stroke();
  }

  ctx.restore();
}

function drawCarLabel(
  ctx: CanvasRenderingContext2D,
  car: RaceCar,
  label: string,
  mine: boolean
) {
  const text = mine ? `ТЫ · ${label}` : label;
  ctx.font = "600 12px sans-serif";
  ctx.textAlign = "center";
  const tw = ctx.measureText(text).width;
  const bx = car.x - tw / 2 - 6;
  const by = car.y - 28;
  ctx.fillStyle = mine ? "rgba(250, 204, 21, 0.92)" : "rgba(15, 23, 42, 0.85)";
  ctx.fillRect(bx, by, tw + 12, 18);
  ctx.fillStyle = mine ? "#0f172a" : "#f1f5f9";
  ctx.fillText(text, car.x, by + 13);
}

function myDeltaFromResult(
  room: RoomView | null,
  userId: string | null
): number | null {
  if (!room?.ratingResult || !userId) return null;
  const entries = room.ratingResult.entries;
  if (Array.isArray(entries)) {
    const hit = entries.find((e) => e.userId === userId);
    return hit ? hit.delta : null;
  }
  if (room.youAreHost && typeof room.ratingResult.deltaHost === "number") {
    return room.ratingResult.deltaHost;
  }
  if (!room.youAreHost && typeof room.ratingResult.deltaGuest === "number") {
    return room.ratingResult.deltaGuest;
  }
  return null;
}

export function KartDuelPanel() {
  const { data: session } = useSession();
  const userId = session?.user?.id || null;
  const [room, setRoom] = useState<RoomView | null>(null);
  const [players, setPlayers] = useState<Peer[]>([]);
  const [capacity, setCapacity] = useState<2 | 3>(2);
  const [myRating, setMyRating] = useState(RACE_RATING_START);
  const [msg, setMsg] = useState("");
  const [queuing, setQueuing] = useState(false);
  const [hudLap, setHudLap] = useState(0);
  const [hudVehicle, setHudVehicle] = useState("");

  const keysRef = useRef<Keys>({ ...EMPTY });
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const roomIdRef = useRef<string | null>(null);
  const statusRef = useRef<string | null>(null);
  const serverStateRef = useRef<RaceState | null>(null);
  const localStateRef = useRef<RaceState | null>(null);
  const simAccRef = useRef(0);
  const lastFrameAtRef = useRef(0);
  const playersRef = useRef<Peer[]>([]);
  const userIdRef = useRef<string | null>(null);
  const hudLapRef = useRef(0);
  const hudVehicleRef = useRef("");

  userIdRef.current = userId;
  playersRef.current = players;
  statusRef.current = room?.status ?? null;

  const paint = useCallback((state: RaceState | null) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;
    const me = userIdRef.current;
    const nickOf = (id: string) =>
      playersRef.current.find((p) => p.userId === id)?.nick || "Игрок";

    if (!state) {
      ctx.fillStyle = "#0b1220";
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "#64748b";
      ctx.font = "16px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Ожидание заезда…", w / 2, h / 2);
      return;
    }

    const { track, obstacles, cars } = state;
    ctx.fillStyle = track.ground || "#0b1220";
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = track.asphalt || "#1e293b";
    ctx.lineWidth = track.width;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    track.points.forEach((p, i) => {
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.closePath();
    ctx.stroke();

    ctx.strokeStyle = track.line || "#334155";
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 10]);
    ctx.beginPath();
    track.points.forEach((p, i) => {
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);

    const p0 = track.points[0]!;
    const p1 = track.points[1]!;
    const ang = Math.atan2(p1.y - p0.y, p1.x - p0.x);
    ctx.strokeStyle = "#f8fafc";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(
      p0.x + Math.cos(ang + Math.PI / 2) * track.width * 0.45,
      p0.y + Math.sin(ang + Math.PI / 2) * track.width * 0.45
    );
    ctx.lineTo(
      p0.x + Math.cos(ang - Math.PI / 2) * track.width * 0.45,
      p0.y + Math.sin(ang - Math.PI / 2) * track.width * 0.45
    );
    ctx.stroke();

    for (const o of obstacles) drawObstacle(ctx, o);

    for (const car of cars) {
      const mine = car.userId === me;
      drawVehicle(ctx, car, mine);
      drawCarLabel(
        ctx,
        car,
        `${nickOf(car.userId)} · ${car.vehicleLabel || "Техника"}`,
        mine
      );
    }

    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.fillRect(12, h - 44, 300, 32);
    ctx.fillStyle = "#e2e8f0";
    ctx.font = "600 14px sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(track.name || "Трасса", 20, h - 24);
    ctx.fillStyle = "#94a3b8";
    ctx.font = "12px sans-serif";
    ctx.fillText(
      track.subtitle || "",
      20 + ctx.measureText(track.name || "").width + 10,
      h - 24
    );
  }, []);

  useEffect(() => {
    const held = new Set<string>();
    const driveCodes = new Set([
      "ArrowUp",
      "ArrowDown",
      "ArrowLeft",
      "ArrowRight",
      "KeyW",
      "KeyA",
      "KeyS",
      "KeyD",
    ]);
    const syncKeys = () => {
      keysRef.current = {
        up: held.has("ArrowUp") || held.has("KeyW"),
        down: held.has("ArrowDown") || held.has("KeyS"),
        left: held.has("ArrowLeft") || held.has("KeyA"),
        right: held.has("ArrowRight") || held.has("KeyD"),
      };
    };
    const down = (e: KeyboardEvent) => {
      if (!driveCodes.has(e.code)) return;
      if (e.repeat) return;
      e.preventDefault();
      held.add(e.code);
      syncKeys();
    };
    const up = (e: KeyboardEvent) => {
      if (!driveCodes.has(e.code)) return;
      held.delete(e.code);
      syncKeys();
    };
    const blur = () => {
      held.clear();
      syncKeys();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, []);

  // Непрерывный локальный симулятор + мягкий reconcile со снапшотом
  useEffect(() => {
    let raf = 0;
    const TICK_MS = 50;
    const frame = (ts: number) => {
      raf = requestAnimationFrame(frame);
      const me = userIdRef.current;
      if (statusRef.current !== "racing" || !me) {
        if (serverStateRef.current) paint(serverStateRef.current);
        return;
      }

      if (!localStateRef.current && serverStateRef.current) {
        localStateRef.current = {
          ...serverStateRef.current,
          cars: serverStateRef.current.cars.map((c) => ({ ...c })),
        };
      }
      const local = localStateRef.current;
      if (!local) return;

      const prev = lastFrameAtRef.current || ts;
      lastFrameAtRef.current = ts;
      let acc = simAccRef.current + Math.min(80, ts - prev);
      // фиксированный шаг физики — без рывков от FPS
      let guard = 0;
      while (acc >= TICK_MS && guard < 3) {
        acc -= TICK_MS;
        guard += 1;
        localStateRef.current = predictMyCar(
          localStateRef.current!,
          me,
          keysRef.current,
          1
        );
      }
      simAccRef.current = acc;

      const draw = localStateRef.current!;
      paint(draw);
      const my = draw.cars.find((c) => c.userId === me);
      if (my) {
        if (hudLapRef.current !== my.lap) {
          hudLapRef.current = my.lap;
          setHudLap(my.lap);
        }
        if (hudVehicleRef.current !== (my.vehicleLabel || "")) {
          hudVehicleRef.current = my.vehicleLabel || "";
          setHudVehicle(my.vehicleLabel || "");
        }
      }
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [paint]);

  // Сеть: input POST отдельно, физика только через GET
  useEffect(() => {
    if (!room?.id) return;
    let alive = true;
    let stateBusy = false;
    let inputBusy = false;

    const applyRoom = (data: {
      room?: RoomView | null;
      players?: Peer[];
      myRating?: number;
    }) => {
      if (!data?.room) return;
      setRoom(data.room);
      roomIdRef.current = data.room.id;
      statusRef.current = data.room.status;
      if (data.room.state) {
        serverStateRef.current = data.room.state;
        const me = userIdRef.current;
        if (me && localStateRef.current && data.room.status === "racing") {
          localStateRef.current = reconcileRaceState(
            localStateRef.current,
            data.room.state,
            me
          );
        } else {
          localStateRef.current = {
            ...data.room.state,
            cars: data.room.state.cars.map((c) => ({ ...c })),
          };
          simAccRef.current = 0;
        }
      }
      if (Array.isArray(data.players)) {
        setPlayers(data.players);
        playersRef.current = data.players;
      }
      if (typeof data.myRating === "number") setMyRating(data.myRating);

      if (data.room.status === "waiting") {
        const need = data.room.capacity === 3 ? 3 : 2;
        const have = data.room.playerIds?.length ?? 1;
        setMsg(`В лобби ${have}/${need}…`);
      } else if (data.room.status === "countdown") {
        setMsg("Старт!");
      } else if (data.room.status === "cancelled") {
        setRoom(null);
        setPlayers([]);
        roomIdRef.current = null;
        statusRef.current = null;
        serverStateRef.current = null;
        localStateRef.current = null;
        setMsg("Соперник отменил матч");
      } else {
        setMsg("");
      }
    };

    const pollState = async () => {
      if (!alive || stateBusy) return;
      const id = roomIdRef.current;
      const status = statusRef.current;
      if (!id || !status || status === "done") return;
      // cancelled обрабатываем один раз через applyRoom, потом id сбросится
      if (status === "cancelled") return;
      stateBusy = true;
      try {
        if (status === "waiting") {
          const res = await fetch("/api/reaction/race/queue", {
            cache: "no-store",
          });
          const data = await res.json().catch(() => null);
          if (!alive || !data) return;
          if (!data.room) {
            setRoom(null);
            setPlayers([]);
            roomIdRef.current = null;
            statusRef.current = null;
            serverStateRef.current = null;
            localStateRef.current = null;
            setMsg("Лобби закрыто");
            return;
          }
          applyRoom(data);
        } else {
          const res = await fetch(
            `/api/reaction/race/input?roomId=${encodeURIComponent(id)}`,
            { cache: "no-store" }
          );
          const data = await res.json().catch(() => null);
          if (alive && data) applyRoom(data);
        }
      } catch {
        /* ignore */
      } finally {
        stateBusy = false;
      }
    };

    const pushInput = async () => {
      if (!alive || inputBusy) return;
      const id = roomIdRef.current;
      if (!id || statusRef.current !== "racing") return;
      inputBusy = true;
      try {
        await fetch("/api/reaction/race/input", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ roomId: id, keys: keysRef.current }),
        });
      } catch {
        /* ignore */
      } finally {
        inputBusy = false;
      }
    };

    let stateTimer = 0;
    let inputTimer = 0;
    const armState = () => {
      const ms =
        statusRef.current === "waiting"
          ? 500
          : statusRef.current === "racing"
            ? 60
            : 100;
      stateTimer = window.setTimeout(async () => {
        await pollState();
        if (alive) armState();
      }, ms);
    };
    const armInput = () => {
      inputTimer = window.setTimeout(async () => {
        await pushInput();
        if (alive) armInput();
      }, 35);
    };

    void pollState();
    armState();
    armInput();

    return () => {
      alive = false;
      window.clearTimeout(stateTimer);
      window.clearTimeout(inputTimer);
    };
  }, [room?.id]);

  async function startQueue() {
    setQueuing(true);
    setMsg(capacity === 3 ? "Ищем лобби на троих…" : "Ищем соперника…");
    try {
      const res = await fetch("/api/reaction/race/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "join", capacity }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setMsg(data?.error || "Ошибка очереди");
        setQueuing(false);
        return;
      }
      if (data.room) {
        setRoom(data.room);
        roomIdRef.current = data.room.id;
        statusRef.current = data.room.status;
        if (data.room.state) {
          serverStateRef.current = data.room.state;
          localStateRef.current = {
            ...data.room.state,
            cars: data.room.state.cars.map((c) => ({ ...c })),
          };
          simAccRef.current = 0;
        }
        if (data.room.capacity === 2 || data.room.capacity === 3) {
          setCapacity(data.room.capacity);
        }
      }
      if (Array.isArray(data.players)) {
        setPlayers(data.players);
        playersRef.current = data.players;
      }
      if (typeof data.myRating === "number") setMyRating(data.myRating);
      const need = data.room?.capacity === 3 ? 3 : 2;
      const have = Array.isArray(data.room?.playerIds)
        ? data.room.playerIds.length
        : 1;
      if (data.room?.status === "waiting") setMsg(`В лобби ${have}/${need}…`);
      else if (data.room?.status === "countdown") setMsg("Старт!");
      else setMsg("");
    } catch {
      setMsg("Сеть недоступна");
    } finally {
      setQueuing(false);
    }
  }

  async function cancelMatch() {
    const id = roomIdRef.current;
    await fetch("/api/reaction/race/queue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "cancel", roomId: id }),
    });
    setRoom(null);
    setPlayers([]);
    roomIdRef.current = null;
    statusRef.current = null;
    serverStateRef.current = null;
    localStateRef.current = null;
    setMsg("Матч отменён");
  }

  const countdownLeft =
    room?.status === "countdown" && room.countdownEndsAt
      ? Math.max(
          0,
          Math.ceil(
            (new Date(room.countdownEndsAt).getTime() - Date.now()) / 1000
          )
        )
      : null;

  const myDelta = myDeltaFromResult(room, userId);
  const lobbySize = room?.capacity ?? capacity;
  const filled = room?.playerIds?.length ?? players.length;
  const idle = !room || room.status === "done" || room.status === "cancelled";

  return (
    <div className="kart-duel">
      <div className="kart-duel-bar">
        <div>
          <strong>Карт-дуэль</strong>
          <span className="muted">
            {" "}
            · 5 кругов · WASD / стрелки · Elo {myRating}
          </span>
        </div>
        <div className="kart-duel-actions">
          {idle ? (
            <>
              <div
                className="kart-duel-capacity"
                role="group"
                aria-label="Размер лобби"
              >
                <button
                  type="button"
                  className={capacity === 2 ? "btn primary" : "btn"}
                  disabled={queuing}
                  onClick={() => setCapacity(2)}
                >
                  2 игрока
                </button>
                <button
                  type="button"
                  className={capacity === 3 ? "btn primary" : "btn"}
                  disabled={queuing}
                  onClick={() => setCapacity(3)}
                >
                  3 игрока
                </button>
              </div>
              <button
                type="button"
                className="btn primary"
                disabled={queuing}
                onClick={() => void startQueue()}
              >
                Играть
              </button>
            </>
          ) : room.status === "waiting" ||
            room.status === "countdown" ||
            room.status === "racing" ? (
            <button
              type="button"
              className="btn"
              onClick={() => void cancelMatch()}
            >
              {room.status === "waiting" ? "Отмена" : "Отменить матч"}
            </button>
          ) : null}
        </div>
      </div>

      <div className="kart-duel-peers">
        {players.length ? (
          players.map((p, i) => {
            const car = serverStateRef.current?.cars.find(
              (c) => c.userId === p.userId
            );
            const mine = p.userId === userId;
            return (
              <span
                key={p.userId || `${p.nick}-${i}`}
                className="kart-duel-peer"
              >
                {i > 0 ? <span className="muted"> · </span> : null}
                <i
                  className="kart-duel-swatch"
                  style={{
                    background:
                      car?.color || (mine ? "#fef08a" : "#94a3b8"),
                  }}
                />
                {mine ? <strong>Ты: </strong> : null}
                {p.nick}
                {car?.vehicleLabel ? (
                  <em className="muted"> · {car.vehicleLabel}</em>
                ) : null}
                <em className="muted"> ({p.raceRating})</em>
              </span>
            );
          })
        ) : (
          <span className="muted">Выбери лобби и жми «Играть»</span>
        )}
        {room?.status === "waiting" ? (
          <span className="muted">
            {" "}
            — {filled}/{lobbySize}
          </span>
        ) : null}
      </div>

      <div className="kart-duel-canvas-wrap">
        <canvas
          ref={canvasRef}
          width={800}
          height={600}
          className="kart-duel-canvas"
        />
        {countdownLeft != null && countdownLeft > 0 ? (
          <div className="kart-duel-countdown">{countdownLeft}</div>
        ) : null}
        {room?.status === "racing" ? (
          <div className="kart-duel-hud">
            Круг {Math.min(hudLap + 1, RACE_LAPS)} / {RACE_LAPS}
            {hudVehicle ? ` · ${hudVehicle}` : ""}
            <span className="kart-duel-hud-you"> · ты = жёлтая рамка</span>
          </div>
        ) : null}
        {room?.status === "done" ? (
          <div className="kart-duel-overlay">
            <p>
              {room.winnerUserId === userId ? "Победа!" : "Поражение"}
              {myDelta != null ? (
                <strong>
                  {" "}
                  {myDelta >= 0 ? `+${myDelta}` : myDelta} Elo
                </strong>
              ) : null}
            </p>
          </div>
        ) : null}
      </div>

      {msg ? <p className="reaction-msg">{msg}</p> : null}
      <p className="muted" style={{ fontSize: "0.82rem", marginTop: 8 }}>
        Своя техника — жёлтая рамка и подпись «ТЫ». Управление: WASD или стрелки.
      </p>
    </div>
  );
}
