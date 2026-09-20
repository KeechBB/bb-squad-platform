import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  normalizeEosId,
  normalizeSteamId,
  sessionEventKey,
  type SquadSessionIngestEvent,
} from "@/lib/squadSessions";
import { livePublish, livePublishSite, userLiveChannel } from "@/lib/liveBus";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Body = {
  events?: SquadSessionIngestEvent[];
  serverKey?: string;
};

function unauthorized() {
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

function checkSecret(req: Request): boolean {
  const secret = process.env.SQUAD_INGEST_SECRET?.trim();
  if (!secret) return false;
  const auth = req.headers.get("authorization") || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const header = req.headers.get("x-squad-ingest-secret")?.trim() || "";
  return bearer === secret || header === secret;
}

async function resolveSteam(
  rawSteam: string,
  eosId: string | null
): Promise<{ steamId: string; userId: string } | null> {
  let steamId = normalizeSteamId(rawSteam);
  if (!steamId && eosId) {
    const mapped = await prisma.squadEosSteamMap.findUnique({
      where: { eosId },
      select: { steamId: true },
    });
    steamId = normalizeSteamId(mapped?.steamId || "") || "";
  }
  if (!steamId) return null;
  const user = await prisma.user.findUnique({
    where: { steamId },
    select: { id: true },
  });
  if (!user) return null;
  return { steamId, userId: user.id };
}

export async function POST(req: Request) {
  if (!checkSecret(req)) return unauthorized();

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const events = Array.isArray(body.events) ? body.events : [];
  if (events.length === 0) {
    return NextResponse.json({ ok: true, accepted: 0, skipped: 0 });
  }
  if (events.length > 500) {
    return NextResponse.json({ error: "too many events" }, { status: 400 });
  }

  const defaultServer = (body.serverKey || "TPUB1").trim() || "TPUB1";
  let accepted = 0;
  let skipped = 0;
  let joins = 0;
  let leaves = 0;

  for (const raw of events) {
    const at = new Date(raw.at);
    if (Number.isNaN(at.getTime())) {
      skipped += 1;
      continue;
    }
    const serverKey = (raw.serverKey || defaultServer).trim() || defaultServer;
    const eosId = raw.eosId ? normalizeEosId(String(raw.eosId)) : null;
    const nick = raw.nick?.trim() || null;
    const type = raw.type === "leave" ? "leave" : "join";

    if (eosId && normalizeSteamId(String(raw.steamId || ""))) {
      const steamForMap = normalizeSteamId(String(raw.steamId || ""))!;
      await prisma.squadEosSteamMap.upsert({
        where: { eosId },
        create: { eosId, steamId: steamForMap, nick },
        update: { steamId: steamForMap, nick: nick || undefined },
      });
    }

    const resolved = await resolveSteam(String(raw.steamId || ""), eosId);
    if (!resolved) {
      skipped += 1;
      continue;
    }
    const { steamId, userId } = resolved;

    if (type === "join") {
      const open = await prisma.squadServerSession.findFirst({
        where: { steamId, serverKey, leftAt: null },
        orderBy: { joinedAt: "desc" },
      });
      if (open) {
        const deltaMs = at.getTime() - open.joinedAt.getTime();
        // Дубль Login/PostLogin в ту же секунду: не закрывать живую сессию
        // (иначе leftAt = joinedAt+1с и в таблице «нет времени»).
        if (deltaMs <= 15_000) {
          skipped += 1;
          continue;
        }
        // Выход потерялся — закрываем старую сессию моментом нового захода
        await prisma.squadServerSession.update({
          where: { id: open.id },
          data: { leftAt: at },
        });
        leaves += 1;
        accepted += 1;
      }

      // Уже есть заход в пределах 15с (закрытый twin Login/PostLogin) — не плодим вторую строку
      const recent = await prisma.squadServerSession.findFirst({
        where: {
          steamId,
          serverKey,
          joinedAt: {
            gte: new Date(at.getTime() - 15_000),
            lte: new Date(at.getTime() + 15_000),
          },
        },
        orderBy: { joinedAt: "desc" },
      });
      if (recent) {
        skipped += 1;
        continue;
      }

      const eventKey = sessionEventKey(serverKey, steamId, at);
      try {
        await prisma.squadServerSession.create({
          data: {
            userId,
            steamId,
            eosId,
            nickAtJoin: nick,
            serverKey,
            joinedAt: at,
            eventKey,
          },
        });
        accepted += 1;
        joins += 1;
        livePublish(
          userLiveChannel(userId),
          JSON.stringify({ type: "session", action: "join", serverKey })
        );
      } catch {
        skipped += 1;
      }
      continue;
    }

    // leave — сначала тот же сервер, иначе любая открытая; запасной путь по eos
    let open = await prisma.squadServerSession.findFirst({
      where: { steamId, serverKey, leftAt: null },
      orderBy: { joinedAt: "desc" },
    });
    if (!open) {
      open = await prisma.squadServerSession.findFirst({
        where: { steamId, leftAt: null },
        orderBy: { joinedAt: "desc" },
      });
    }
    if (!open && eosId) {
      open = await prisma.squadServerSession.findFirst({
        where: { eosId, leftAt: null },
        orderBy: { joinedAt: "desc" },
      });
    }
    if (!open || open.joinedAt.getTime() > at.getTime()) {
      skipped += 1;
      continue;
    }
    await prisma.squadServerSession.update({
      where: { id: open.id },
      data: {
        leftAt: at,
        eosId: open.eosId || eosId,
        nickAtJoin: open.nickAtJoin || nick,
      },
    });
    accepted += 1;
    leaves += 1;
    livePublish(
      userLiveChannel(userId),
      JSON.stringify({ type: "session", action: "leave", serverKey })
    );
  }

  if (accepted > 0) {
    livePublishSite({
      kind: "attendance",
      joins,
      leaves,
      accepted,
      t: Date.now(),
    });
  }

  return NextResponse.json({ ok: true, accepted, skipped, joins, leaves });
}
