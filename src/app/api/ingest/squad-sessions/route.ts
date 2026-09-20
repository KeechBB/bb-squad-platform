import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  normalizeEosId,
  normalizeSteamId,
  sessionEventKey,
  type SquadSessionIngestEvent,
} from "@/lib/squadSessions";

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

  for (const raw of events) {
    const steamId = normalizeSteamId(String(raw.steamId || ""));
    if (!steamId) {
      skipped += 1;
      continue;
    }
    const at = new Date(raw.at);
    if (Number.isNaN(at.getTime())) {
      skipped += 1;
      continue;
    }
    const serverKey = (raw.serverKey || defaultServer).trim() || defaultServer;
    const eosId = raw.eosId ? normalizeEosId(String(raw.eosId)) : null;
    const nick = raw.nick?.trim() || null;
    const type = raw.type === "leave" ? "leave" : "join";

    if (eosId) {
      await prisma.squadEosSteamMap.upsert({
        where: { eosId },
        create: { eosId, steamId, nick },
        update: { steamId, nick: nick || undefined },
      });
    }

    const user = await prisma.user.findUnique({
      where: { steamId },
      select: { id: true },
    });
    if (!user) {
      skipped += 1;
      continue;
    }

    if (type === "join") {
      const open = await prisma.squadServerSession.findFirst({
        where: { steamId, serverKey, leftAt: null },
        orderBy: { joinedAt: "desc" },
      });
      if (open) {
        skipped += 1;
        continue;
      }
      const eventKey = sessionEventKey(serverKey, steamId, at);
      try {
        await prisma.squadServerSession.create({
          data: {
            userId: user.id,
            steamId,
            eosId,
            nickAtJoin: nick,
            serverKey,
            joinedAt: at,
            eventKey,
          },
        });
        accepted += 1;
      } catch {
        skipped += 1;
      }
      continue;
    }

    // leave
    const open = await prisma.squadServerSession.findFirst({
      where: { steamId, serverKey, leftAt: null },
      orderBy: { joinedAt: "desc" },
    });
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
  }

  return NextResponse.json({ ok: true, accepted, skipped });
}
