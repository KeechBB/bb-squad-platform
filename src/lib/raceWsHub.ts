/**
 * WebSocket-хаб «Карт-дуэль»: пуш позиций ~20 Hz.
 * HTTP матчмейкинг / отмена / Elo остаются как были.
 */
import type { IncomingMessage, Server as HttpServer } from "http";
import type { Duplex } from "stream";
import { WebSocketServer, WebSocket } from "ws";
import { getToken } from "next-auth/jwt";
import { prisma } from "@/lib/prisma";
import {
  advanceRaceRoom,
  isInRaceRoom,
  loadRacePeers,
  publicRaceView,
  setRaceInput,
} from "@/lib/raceMatch";
import { EMPTY_KEYS, type RaceKeys, type RacePose } from "@/lib/raceEngine";

type AuthedSocket = WebSocket & {
  userId?: string;
  roomId?: string;
  alive?: boolean;
};

type RoomClient = {
  ws: AuthedSocket;
  userId: string;
};

const rooms = new Map<string, Set<RoomClient>>();
const TICK_MS = 50;

function parseKeys(raw: unknown): RaceKeys {
  if (!raw || typeof raw !== "object") return { ...EMPTY_KEYS };
  const o = raw as Record<string, unknown>;
  return {
    up: Boolean(o.up),
    down: Boolean(o.down),
    left: Boolean(o.left),
    right: Boolean(o.right),
  };
}

function parsePose(raw: unknown): RacePose | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const x = Number(o.x);
  const y = Number(o.y);
  const angle = Number(o.angle);
  const speed = Number(o.speed);
  const lap = Number(o.lap);
  const progress = Number(o.progress);
  if (![x, y, angle, speed, progress].every(Number.isFinite)) return null;
  return {
    x,
    y,
    angle,
    speed,
    lap: Number.isFinite(lap) ? lap : 0,
    progress,
  };
}

function send(ws: WebSocket, payload: unknown) {
  if (ws.readyState !== WebSocket.OPEN) return;
  try {
    ws.send(JSON.stringify(payload));
  } catch {
    /* ignore */
  }
}

function leaveRoom(client: RoomClient) {
  const set = rooms.get(client.ws.roomId || "");
  if (!set) return;
  set.delete(client);
  if (set.size === 0 && client.ws.roomId) {
    rooms.delete(client.ws.roomId);
  }
}

async function broadcastRoom(roomId: string) {
  const set = rooms.get(roomId);
  if (!set || set.size === 0) return;

  const advanced = await advanceRaceRoom(roomId);
  if (!advanced) return;

  const players = await loadRacePeers(advanced);
  for (const client of [...set]) {
    if (client.ws.readyState !== WebSocket.OPEN) {
      set.delete(client);
      continue;
    }
    send(client.ws, {
      type: "room",
      room: publicRaceView(advanced, client.userId),
      players,
      transport: "ws",
    });
  }

  if (
    advanced.status === "done" ||
    advanced.status === "cancelled"
  ) {
    // даём клиентам получить финальный кадр, потом можно не держать room
    setTimeout(() => {
      const cur = rooms.get(roomId);
      if (!cur) return;
      for (const c of cur) {
        try {
          c.ws.close(1000, advanced.status);
        } catch {
          /* ignore */
        }
      }
      rooms.delete(roomId);
    }, 1500);
  }
}

async function tickAllRooms() {
  const ids = [...rooms.keys()];
  for (const roomId of ids) {
    try {
      await broadcastRoom(roomId);
    } catch (err) {
      console.error("race ws tick", roomId, err);
    }
  }
}

export function attachRaceWebSocket(server: HttpServer) {
  const wss = new WebSocketServer({ noServer: true });

  server.on(
    "upgrade",
    (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      void (async () => {
        try {
          const host = req.headers.host || "localhost";
          const url = new URL(req.url || "/", `http://${host}`);
          if (url.pathname !== "/api/reaction/race/ws") {
            // чужой upgrade не трогаем — иначе сломаем HMR/другие WS
            return;
          }

          // getToken читает Cookie из headers; для raw upgrade-req достаточно cast
          const token = await getToken({
            req: req as Parameters<typeof getToken>[0]["req"],
            secret: process.env.NEXTAUTH_SECRET,
          });

          const steamId = typeof token?.steamId === "string" ? token.steamId : "";
          const userId = typeof token?.id === "string" ? token.id : "";
          if (!steamId || !userId) {
            socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
            socket.destroy();
            return;
          }

          wss.handleUpgrade(req, socket, head, (ws) => {
            const authed = ws as AuthedSocket;
            authed.userId = userId;
            authed.alive = true;
            wss.emit("connection", authed, req);
          });
        } catch (err) {
          console.error("ws upgrade", err);
          try {
            socket.destroy();
          } catch {
            /* ignore */
          }
        }
      })();
    }
  );

  wss.on("connection", (ws: AuthedSocket) => {
    let client: RoomClient | null = null;

    ws.on("pong", () => {
      ws.alive = true;
    });

    ws.on("message", (data) => {
      void (async () => {
        try {
          const msg = JSON.parse(String(data)) as Record<string, unknown>;
          const type = String(msg.type || "");

          if (type === "join") {
            const roomId = String(msg.roomId || "");
            const userId = ws.userId || "";
            if (!roomId || !userId) {
              send(ws, { type: "error", error: "Нужен roomId" });
              return;
            }
            const room = await prisma.reactionRaceRoom.findUnique({
              where: { id: roomId },
            });
            if (!room || !isInRaceRoom(room, userId)) {
              send(ws, { type: "error", error: "Комната недоступна" });
              ws.close(1008, "forbidden");
              return;
            }
            if (client) leaveRoom(client);
            ws.roomId = roomId;
            client = { ws, userId };
            let set = rooms.get(roomId);
            if (!set) {
              set = new Set();
              rooms.set(roomId, set);
            }
            set.add(client);
            await broadcastRoom(roomId);
            return;
          }

          if (type === "input") {
            const userId = ws.userId || "";
            const roomId = ws.roomId || String(msg.roomId || "");
            if (!userId || !roomId) return;
            await setRaceInput(
              roomId,
              userId,
              parseKeys(msg.keys),
              parsePose(msg.pose)
            );
            return;
          }

          if (type === "ping") {
            send(ws, { type: "pong", t: Date.now() });
          }
        } catch (err) {
          console.error("ws message", err);
        }
      })();
    });

    ws.on("close", () => {
      if (client) leaveRoom(client);
    });
  });

  const tick = setInterval(() => {
    void tickAllRooms();
  }, TICK_MS);

  const heartbeat = setInterval(() => {
    wss.clients.forEach((ws) => {
      const s = ws as AuthedSocket;
      if (s.alive === false) {
        try {
          s.terminate();
        } catch {
          /* ignore */
        }
        return;
      }
      s.alive = false;
      try {
        s.ping();
      } catch {
        /* ignore */
      }
    });
  }, 25000);

  wss.on("close", () => {
    clearInterval(tick);
    clearInterval(heartbeat);
  });

  console.log("> race websocket on /api/reaction/race/ws");
}
