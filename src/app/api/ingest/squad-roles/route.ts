import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { livePublish, livePublishSite, userLiveChannel } from "@/lib/liveBus";
import { kitFromDeployRole } from "@/lib/squadKits";
import {
  normalizeEosId,
  normalizeSteamId,
  roleEventKey,
  type SquadRoleIngestEvent,
} from "@/lib/squadRoles";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Body = {
  events?: SquadRoleIngestEvent[];
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

async function resolveUser(opts: {
  steamRaw: string;
  eosId: string | null;
  nick: string | null;
}): Promise<{ steamId: string; userId: string } | null> {
  let steamId = normalizeSteamId(opts.steamRaw);
  if (!steamId && opts.eosId) {
    const mapped = await prisma.squadEosSteamMap.findUnique({
      where: { eosId: opts.eosId },
      select: { steamId: true },
    });
    steamId = normalizeSteamId(mapped?.steamId || "") || "";
  }
  if (steamId) {
    const user = await prisma.user.findUnique({
      where: { steamId },
      select: { id: true },
    });
    if (user) return { steamId, userId: user.id };
  }
  const nick = (opts.nick || "").trim();
  if (nick) {
    const byNick = await prisma.user.findFirst({
      where: {
        profileComplete: true,
        nick: { equals: nick, mode: "insensitive" },
      },
      select: { id: true, steamId: true },
    });
    if (byNick) {
      return {
        steamId: normalizeSteamId(byNick.steamId) || byNick.steamId,
        userId: byNick.id,
      };
    }
  }
  return null;
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
  if (events.length > 2000) {
    return NextResponse.json({ error: "too many events" }, { status: 400 });
  }
  if (events.length === 0) {
    return NextResponse.json({ ok: true, accepted: 0, skipped: 0 });
  }

  const defaultServer = (body.serverKey || "TR1").trim() || "TR1";
  let accepted = 0;
  let skipped = 0;
  const touchedUsers = new Set<string>();

  for (const raw of events) {
    if (raw.type && raw.type !== "role") {
      skipped += 1;
      continue;
    }
    const at = new Date(raw.at);
    if (Number.isNaN(at.getTime())) {
      skipped += 1;
      continue;
    }
    const roleRaw = String(raw.role || "").trim();
    const kit = kitFromDeployRole(roleRaw);
    if (!kit) {
      skipped += 1;
      continue;
    }
    const serverKey = (raw.serverKey || defaultServer).trim() || defaultServer;
    if (serverKey !== "TR1") {
      skipped += 1;
      continue;
    }

    const eosId = raw.eosId ? normalizeEosId(String(raw.eosId)) : null;
    const steamRaw = normalizeSteamId(String(raw.steamId || "")) || "";
    const nick =
      raw.nick == null ? null : String(raw.nick).trim() || null;

    if (eosId && steamRaw) {
      await prisma.squadEosSteamMap.upsert({
        where: { eosId },
        create: { eosId, steamId: steamRaw, nick: nick || undefined },
        update: {
          steamId: steamRaw,
          ...(nick ? { nick } : {}),
        },
      });
    }

    const resolved = await resolveUser({ steamRaw, eosId, nick });
    if (!resolved) {
      skipped += 1;
      continue;
    }
    const { steamId, userId } = resolved;
    const userKey = eosId || steamId;
    const eventKey = roleEventKey({
      serverKey,
      spawnedAt: at,
      userKey,
      roleRaw,
    });

    try {
      await prisma.squadRoleEvent.create({
        data: {
          userId,
          steamId,
          eosId,
          nickAtSpawn: nick,
          roleRaw,
          kit,
          serverKey,
          spawnedAt: at,
          eventKey,
        },
      });
      accepted += 1;
      touchedUsers.add(userId);
    } catch {
      skipped += 1;
    }
  }

  for (const userId of touchedUsers) {
    livePublish(
      userLiveChannel(userId),
      JSON.stringify({ type: "kits", t: Date.now() })
    );
  }
  if (accepted > 0) {
    livePublishSite({
      kind: "kits",
      accepted,
      skipped,
      t: Date.now(),
    });
  }

  return NextResponse.json({ ok: true, accepted, skipped });
}
