"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { RACE_LAPS, RACE_RATING_START } from "@/lib/reaction";
import type { RaceState } from "@/lib/raceEngine";

type RoomView = {
  id: string;
  status: string;
  seed: number;
  hostUserId: string;
  guestUserId: string | null;
  winnerUserId: string | null;
  countdownEndsAt: string | null;
  youAreHost: boolean;
  state: RaceState | null;
  ratingResult: {
    beforeHost: number;
    beforeGuest: number;
    deltaHost: number;
    deltaGuest: number;
    afterHost: number;
    afterGuest: number;
  } | null;
};

type Peer = { nick: string; raceRating: number };

type Keys = { up: boolean; down: boolean; left: boolean; right: boolean };

const EMPTY: Keys = { up: false, down: false, left: false, right: false };

export function KartDuelPanel() {
  const { data: session } = useSession();
  const userId = session?.user?.id || null;
  const [room, setRoom] = useState<RoomView | null>(null);
  const [host, setHost] = useState<Peer | null>(null);
  const [guest, setGuest] = useState<Peer | null>(null);
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
    ctx.fillStyle = "#0b1220";
    ctx.fillRect(0, 0, w, h);

    if (!state) {
      ctx.fillStyle = "#64748b";
      ctx.font = "16px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Ожидание заезда…", w / 2, h / 2);
      return;
    }

    const { track, obstacles, cars } = state;
    // asphalt ribbon
    ctx.strokeStyle = "#1e293b";
    ctx.lineWidth = track.width;
    ctx.lineJoin = "round";
    ctx.beginPath();
    track.points.forEach((p, i) => {
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.closePath();
    ctx.stroke();

    ctx.strokeStyle = "#334155";
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

    // start line
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
      ctx.fillStyle = "#78716c";
      ctx.beginPath();
      ctx.arc(o.x, o.y, o.r, 0, Math.PI * 2);
      ctx.fill();
    }

    for (const car of cars) {
      ctx.save();
      ctx.translate(car.x, car.y);
      ctx.rotate(car.angle);
      ctx.fillStyle = car.color;
      ctx.fillRect(-14, -8, 28, 16);
      ctx.fillStyle = "#0f172a";
      ctx.fillRect(4, -5, 8, 10);
      if (car.userId === userId) {
        ctx.strokeStyle = "#fef08a";
        ctx.lineWidth = 2;
        ctx.strokeRect(-15, -9, 30, 18);
      }
      ctx.restore();
    }
  }, [userId]);

  useEffect(() => {
    paint(room?.state ?? null);
  }, [room, paint]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
        e.preventDefault();
      }
      const k = keysRef.current;
      if (e.key === "ArrowUp") k.up = true;
      if (e.key === "ArrowDown") k.down = true;
      if (e.key === "ArrowLeft") k.left = true;
      if (e.key === "ArrowRight") k.right = true;
    };
    const up = (e: KeyboardEvent) => {
      const k = keysRef.current;
      if (e.key === "ArrowUp") k.up = false;
      if (e.key === "ArrowDown") k.down = false;
      if (e.key === "ArrowLeft") k.left = false;
      if (e.key === "ArrowRight") k.right = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  // poll room / send inputs
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
          if (data?.host) setHost(data.host);
          if (data?.guest) setGuest(data.guest);
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
          if (data?.host) setHost(data.host);
          if (data?.guest) setGuest(data.guest);
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
    setMsg("Ищем соперника…");
    try {
      const res = await fetch("/api/reaction/race/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "join" }),
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
      }
      if (data.host) setHost(data.host);
      if (data.guest) setGuest(data.guest);
      if (typeof data.myRating === "number") setMyRating(data.myRating);
      setMsg(
        data.room?.status === "waiting"
          ? "Ждём второго игрока…"
          : "Соперник найден!"
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
  const ratingResult = room?.ratingResult;
  const myDelta =
    ratingResult && userId
      ? room?.youAreHost
        ? ratingResult.deltaHost
        : ratingResult.deltaGuest
      : null;

  return (
    <div className="kart-duel">
      <div className="kart-duel-bar">
        <div>
          <strong>Карт-дуэль</strong>
          <span className="muted">
            {" "}
            · 5 кругов · стрелки · Elo {myRating}
          </span>
        </div>
        <div className="kart-duel-actions">
          {!room || room.status === "done" || room.status === "cancelled" ? (
            <button
              type="button"
              className="btn primary"
              disabled={queuing}
              onClick={() => void startQueue()}
            >
              Играть
            </button>
          ) : room.status === "waiting" ? (
            <button type="button" className="btn" onClick={() => void cancelQueue()}>
              Отмена
            </button>
          ) : null}
        </div>
      </div>

      <div className="kart-duel-peers">
        <span>
          {host?.nick || "—"}{" "}
          <em className="muted">({host?.raceRating ?? "—"})</em>
        </span>
        <span className="muted">vs</span>
        <span>
          {guest?.nick || "ожидание…"}{" "}
          <em className="muted">
            {guest ? `(${guest.raceRating})` : ""}
          </em>
        </span>
      </div>

      <div className="kart-duel-canvas-wrap">
        <canvas ref={canvasRef} width={800} height={600} className="kart-duel-canvas" />
        {countdownLeft != null && countdownLeft > 0 ? (
          <div className="kart-duel-countdown">{countdownLeft}</div>
        ) : null}
        {room?.status === "racing" && myCar ? (
          <div className="kart-duel-hud">
            Круг {Math.min(myCar.lap + 1, RACE_LAPS)} / {RACE_LAPS}
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
        Управление: стрелки на клавиатуре. Нужен второй игрок на сайте.
      </p>
    </div>
  );
}
