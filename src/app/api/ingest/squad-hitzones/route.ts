import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  normalizeZone,
  resolveAttackerSteam,
  ymdMskFromIso,
  type HitZoneIngestEvent,
} from "@/lib/hitZones";
import { normalizeEosId } from "@/lib/squadSessions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Body = {
  events?: HitZoneIngestEvent[];
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
  if (events.length > 2000) {
    return NextResponse.json({ error: "too many events" }, { status: 400 });
  }

  let accepted = 0;
  let skipped = 0;

  for (const ev of events) {
    if (!ev || ev.type !== "hitzone") {
      skipped += 1;
      continue;
    }
    const zone = normalizeZone(String(ev.zone || ""));
    if (!zone) {
      skipped += 1;
      continue;
    }
    const at = String(ev.at || "").trim();
    if (!at || Number.isNaN(Date.parse(at))) {
      skipped += 1;
      continue;
    }
    const serverKey = String(ev.serverKey || body.serverKey || "TR1").trim() || "TR1";
    const eos = normalizeEosId(ev.attackerEosId || "") || null;
    const resolved = await resolveAttackerSteam(ev.attackerSteamId, eos);
    if (!resolved) {
      skipped += 1;
      continue;
    }

    const ymd = ymdMskFromIso(at);
    const inc = {
      hitsHead: zone === "Head" ? 1 : 0,
      hitsTorso: zone === "Torso" ? 1 : 0,
      hitsLimb: zone === "Limb" ? 1 : 0,
    };

    await prisma.trainHitZoneDay.upsert({
      where: {
        userId_ymd_serverKey: {
          userId: resolved.userId,
          ymd,
          serverKey,
        },
      },
      create: {
        userId: resolved.userId,
        steamId: resolved.steamId,
        ymd,
        serverKey,
        ...inc,
      },
      update: {
        hitsHead: { increment: inc.hitsHead },
        hitsTorso: { increment: inc.hitsTorso },
        hitsLimb: { increment: inc.hitsLimb },
        steamId: resolved.steamId,
      },
    });
    accepted += 1;
  }

  return NextResponse.json({ ok: true, accepted, skipped });
}
