import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { livePublish, livePublishSite, userLiveChannel } from "@/lib/liveBus";
import {
  hitEventKey,
  normalizeBone,
  normalizeEosId,
  normalizeSteamId,
  normalizeZone,
  parseDamage,
  type SquadHitIngestEvent,
} from "@/lib/squadHits";
import { isTrainingServerKey } from "@/lib/squadServers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Body = {
  events?: SquadHitIngestEvent[];
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
    if (raw.type && raw.type !== "hit") {
      skipped += 1;
      continue;
    }
    const at = new Date(raw.at);
    if (Number.isNaN(at.getTime())) {
      skipped += 1;
      continue;
    }
    const bone = normalizeBone(raw.bone == null ? null : String(raw.bone));
    if (!bone) {
      skipped += 1;
      continue;
    }
    const serverKey = (raw.serverKey || defaultServer).trim() || defaultServer;
    if (!isTrainingServerKey(serverKey)) {
      skipped += 1;
      continue;
    }

    const eosId = raw.eosId ? normalizeEosId(String(raw.eosId)) : null;
    const victimEos = raw.victimEos
      ? normalizeEosId(String(raw.victimEos))
      : null;
    const steamRaw = normalizeSteamId(String(raw.steamId || "")) || "";

    if (eosId && steamRaw) {
      await prisma.squadEosSteamMap.upsert({
        where: { eosId },
        create: { eosId, steamId: steamRaw },
        update: { steamId: steamRaw },
      });
    }

    const resolved = await resolveSteam(steamRaw, eosId);
    if (!resolved) {
      skipped += 1;
      continue;
    }
    const { steamId, userId } = resolved;
    const zone = normalizeZone(raw.zone == null ? null : String(raw.zone));
    const damage = parseDamage(raw.damage);
    const weapon =
      raw.weapon == null ? null : String(raw.weapon).trim() || null;
    const attackerKey = eosId || steamId;
    const eventKey = hitEventKey({
      serverKey,
      hitAt: at,
      attackerKey,
      victimEos: victimEos || "",
      bone,
      damage,
      weapon: weapon || "",
    });

    try {
      await prisma.squadHitEvent.create({
        data: {
          userId: userId || undefined,
          steamId,
          eosId,
          victimEos,
          zone,
          bone,
          damage,
          weapon,
          serverKey,
          hitAt: at,
          eventKey,
        },
      });
      accepted += 1;
      if (userId) touchedUsers.add(userId);
    } catch {
      skipped += 1;
    }
  }

  for (const userId of touchedUsers) {
    livePublish(
      userLiveChannel(userId),
      JSON.stringify({ type: "hitmap", t: Date.now() })
    );
  }
  if (accepted > 0) {
    livePublishSite({
      kind: "hitmap",
      accepted,
      skipped,
      t: Date.now(),
    });
  }

  return NextResponse.json({ ok: true, accepted, skipped });
}
