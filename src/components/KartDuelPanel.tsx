"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { RACE_LAPS, RACE_RATING_START } from "@/lib/reaction";
import type { RaceCar, RaceObstacle, RaceState } from "@/lib/raceEngine";
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

function drawObstacle(
  ctx: CanvasRenderingContext2D,
  o: RaceObstacle
) {
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
    ctx.lineWidth = 2;
    ctx.strokeRect(-18, -12, 36, 24);
  }

  ctx.fillStyle = car.color || "#4b5563";
  ctx.strokeStyle = car.accent || "#9ca3af";
  ctx.lineWidth = 1.5;

  if (kind === "atv") {
    // узкий багги
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
    // длинный кузов
    ctx.fillRect(-18, -9, 36, 18);
    ctx.fillStyle = "#1c1917";
    ctx.fillRect(8, -7, 10, 14);
    ctx.fillStyle = car.accent;
    ctx.fillRect(-16, -7, 18, 14);
    ctx.strokeRect(-18, -9, 36, 18);
  } else if (kind === "btr") {
    // вытянутый бронекорпус + башня
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
    // квадратный внедорожник
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
    // пулемётная турель
    ctx.fillStyle = "#a8a29e";
    ctx.fillRect(4, -3, 12, 6);
  } else {
    // MRAP — высокий широкий корпус
    ctx.fillRect(-17, -11, 34, 22);
    ctx.fillStyle = "#1f2937";
    ctx.fillRect(0, -9, 15, 18);
    ctx.fillStyle = car.accent;
    ctx.fillRect(-14, -8, 11, 16);
    ctx.strokeRect(-17, -11, 34, 22);
    // решётка
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
  const keysRef = useRef<Keys>({ ...EMPTY });
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const roomIdRef = useRef<string | null>(null);

  const paint = useCallback((state: RaceState | null) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;

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

    for (const o of obstacles) {
      drawObstacle(ctx, o);
    }

    for (const car of cars) {
      drawVehicle(ctx, car, car.userId === userId);
    }

    // название карты
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.fillRect(12, h - 44, 280, 32);
    ctx.fillStyle = "#e2e8f0";
    ctx.font = "600 14px sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(track.name || "Трасса", 20, h - 24);
    ctx.fillStyle = "#94a3b8";
    ctx.font = "12px sans-serif";
    ctx.fillText(track.subtitle || "", 20 + ctx.measureText(track.name || "").width + 10, h - 24);
  }, [userId]);

  useEffect(() => {
    paint(room?.state ?? null);
  }, [room, paint]);

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

  useEffect(() => {
    let alive = true;
    const loop = async () => {
      if (!alive) return;
      const id = roomIdRef.current;
      if (!id) return;
      try {
        if (room?.status === "waiting") {
          const res = await fetch("/api/reaction/race/queue", { cache: "no-store" });
          const data = await res.json().catch(() => null);
          if (data?.room) {
            setRoom(data.room);
            roomIdRef.current = data.room.id;
          }
          if (Array.isArray(data?.players)) setPlayers(data.players);
          if (typeof data?.myRating === "number") setMyRating(data.myRating);
        } else if (room?.status === "racing") {
          const res = await fetch("/api/reaction/race/input", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ roomId: id, keys: keysRef.current }),
          });
          const data = await res.json().catch(() => null);
          if (data?.room) setRoom(data.room);
        } else {
          const res = await fetch(
            `/api/reaction/race/input?roomId=${encodeURIComponent(id)}`,
            { cache: "no-store" }
          );
          const data = await res.json().catch(() => null);
          if (data?.room) setRoom(data.room);
          if (Array.isArray(data?.players)) setPlayers(data.players);
          if (typeof data?.myRating === "number") setMyRating(data.myRating);
        }
      } catch {
        /* ignore */
      }
    };
    const t = window.setInterval(loop, room?.status === "waiting" ? 700 : 80);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [room?.status]);

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
        if (data.room.capacity === 2 || data.room.capacity === 3) {
          setCapacity(data.room.capacity);
        }
      }
      if (Array.isArray(data.players)) setPlayers(data.players);
      if (typeof data.myRating === "number") setMyRating(data.myRating);
      const need = data.room?.capacity === 3 ? 3 : 2;
      const have = Array.isArray(data.room?.playerIds)
        ? data.room.playerIds.length
        : 1;
      setMsg(
        data.room?.status === "waiting"
          ? `В лобби ${have}/${need}…`
          : "Лобби собрано!"
      );
    } catch {
      setMsg("Сеть недоступна");
    } finally {
      setQueuing(false);
    }
  }

  async function cancelQueue() {
    await fetch("/api/reaction/race/queue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "leave" }),
    });
    setRoom(null);
    setPlayers([]);
    roomIdRef.current = null;
    setMsg("Очередь отменена");
  }

  const countdownLeft =
    room?.status === "countdown" && room.countdownEndsAt
      ? Math.max(
          0,
          Math.ceil((new Date(room.countdownEndsAt).getTime() - Date.now()) / 1000)
        )
      : null;

  const myCar = room?.state?.cars.find((c) => c.userId === userId);
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
              <div className="kart-duel-capacity" role="group" aria-label="Размер лобби">
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
          ) : room.status === "waiting" ? (
            <button type="button" className="btn" onClick={() => void cancelQueue()}>
              Отмена
            </button>
          ) : null}
        </div>
      </div>

      <div className="kart-duel-peers">
        {players.length ? (
          players.map((p, i) => (
            <span key={p.userId || `${p.nick}-${i}`}>
              {i > 0 ? <span className="muted"> · </span> : null}
              {p.nick}{" "}
              <em className="muted">({p.raceRating})</em>
            </span>
          ))
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
        <canvas ref={canvasRef} width={800} height={600} className="kart-duel-canvas" />
        {countdownLeft != null && countdownLeft > 0 ? (
          <div className="kart-duel-countdown">{countdownLeft}</div>
        ) : null}
        {room?.status === "racing" && myCar ? (
          <div className="kart-duel-hud">
            Круг {Math.min(myCar.lap + 1, RACE_LAPS)} / {RACE_LAPS}
            {myCar.vehicleLabel ? ` · ${myCar.vehicleLabel}` : ""}
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
        Управление: WASD или стрелки. 6 трасс Squad (Нарва, Фаллуджа, Goose Bay,
        Маникуаган, Аль-Басра, Харю). Техника: MRAP, Тигр, ATV, M-ATV, Logi, БТР.
      </p>
    </div>
  );
}
