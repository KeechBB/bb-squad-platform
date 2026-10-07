import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  normalizeEosId,
  normalizeSteamId,
  sessionEventKey,
  staleOpenHours,
  type SquadSessionIngestEvent,
} from "@/lib/squadSessions";
import { isPublicServerKey, isTrainingServerKey } from "@/lib/squadServers";
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

/** Steam always; userId only if registered on the site. */
async function resolveSteamIdentity(
  rawSteam: string,
  eosId: string | null
): Promise<{ steamId: string; userId: string | null } | null> {
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
  return { steamId, userId: user?.id ?? null };
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
  if (events.length > 500) {
    return NextResponse.json({ error: "too many events" }, { status: 400 });
  }

  if (events.length === 0) {
    const staleClosed = await closeStaleOpenSessions();
    return NextResponse.json({
      ok: true,
      accepted: staleClosed,
      skipped: 0,
      joins: 0,
      leaves: staleClosed,
      staleClosed,
    });
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
    const isPublic = isPublicServerKey(serverKey);
    const isTraining = isTrainingServerKey(serverKey);

    if (eosId && normalizeSteamId(String(raw.steamId || ""))) {
      const steamForMap = normalizeSteamId(String(raw.steamId || ""))!;
      await prisma.squadEosSteamMap.upsert({
        where: { eosId },
        create: { eosId, steamId: steamForMap, nick },
        update: { steamId: steamForMap, nick: nick || undefined },
      });
    }

    const identity = await resolveSteamIdentity(String(raw.steamId || ""), eosId);
    if (!identity) {
      skipped += 1;
      continue;
    }
    const { steamId, userId } = identity;

    // TR1/TR2/PB1 — пишем всех по Steam (соперники КВ без аккаунта тоже).
    // userId заполняем, если зареган.
    if (!isPublic && !isTraining && !userId) {
      skipped += 1;
      continue;
    }

    if (type === "join") {
      const open = await prisma.squadServerSession.findFirst({
        where: { steamId, serverKey, leftAt: null },
        orderBy: { joinedAt: "desc" },
      });
      if (open) {
        const deltaMs = at.getTime() - open.joinedAt.getTime();
        if (deltaMs <= 15_000) {
          skipped += 1;
          continue;
        }
        await prisma.squadServerSession.update({
          where: { id: open.id },
          data: { leftAt: at },
        });
        leaves += 1;
        accepted += 1;
      }

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
            userId: userId || null,
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
        if (userId) {
          livePublish(
            userLiveChannel(userId),
            JSON.stringify({ type: "session", action: "join", serverKey })
          );
        }
      } catch {
        skipped += 1;
      }
      continue;
    }

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
        // если игрок успел зарегаться — допишем userId
        ...(userId && !open.userId ? { userId } : {}),
      },
    });
    accepted += 1;
    leaves += 1;
    const liveUserId = userId || open.userId;
    if (liveUserId) {
      livePublish(
        userLiveChannel(liveUserId),
        JSON.stringify({ type: "session", action: "leave", serverKey })
      );
    }
  }

  const staleClosed = await closeStaleOpenSessions();
  if (staleClosed > 0) {
    leaves += staleClosed;
    accepted += staleClosed;
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

  return NextResponse.json({
    ok: true,
    accepted,
    skipped,
    joins,
    leaves,
    staleClosed,
  });
}

async function closeStaleOpenSessions(): Promise<number> {
  const hours = staleOpenHours();
  const cutoff = new Date(Date.now() - hours * 3600_000);
  const stale = await prisma.squadServerSession.findMany({
    where: { leftAt: null, joinedAt: { lt: cutoff } },
    select: { id: true, joinedAt: true },
    take: 200,
  });
  if (stale.length === 0) return 0;
  let n = 0;
  for (const s of stale) {
    const leaveAt = new Date(s.joinedAt.getTime() + hours * 3600_000);
    await prisma.squadServerSession.update({
      where: { id: s.id },
      data: { leftAt: leaveAt },
    });
    n += 1;
  }
  return n;
}
