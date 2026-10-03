import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  isSeedLayer,
  normalizePublicMatchServerKey,
  publicMatchEventKey,
  type PublicMatchIngestEvent,
} from "@/lib/publicMatches";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Body = {
  events?: PublicMatchIngestEvent[];
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

function asInt(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
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
    return NextResponse.json({ ok: true, accepted: 0, skipped: 0 });
  }

  const defaultServer =
    normalizePublicMatchServerKey(body.serverKey) || "TPUB1";
  let accepted = 0;
  let skipped = 0;

  for (const raw of events) {
    if (raw.type && raw.type !== "match") {
      skipped += 1;
      continue;
    }
    const endedAt = new Date(raw.at);
    if (Number.isNaN(endedAt.getTime())) {
      skipped += 1;
      continue;
    }
    const serverKey =
      normalizePublicMatchServerKey(raw.serverKey) || defaultServer;
    if (!serverKey) {
      skipped += 1;
      continue;
    }
    const mapName = String(raw.mapName || "").trim();
    const layerName = raw.layerName ? String(raw.layerName).trim() : null;
    if (!mapName) {
      skipped += 1;
      continue;
    }
    if (isSeedLayer(layerName) || isSeedLayer(mapName)) {
      skipped += 1;
      continue;
    }
    const faction1 = String(raw.faction1 || "").trim();
    const faction2 = String(raw.faction2 || "").trim();
    const score1 = asInt(raw.score1);
    const score2 = asInt(raw.score2);
    const winnerTeam = asInt(raw.winnerTeam);
    const winnerName = String(raw.winnerName || "").trim();
    if (
      !faction1 ||
      !faction2 ||
      score1 == null ||
      score2 == null ||
      (winnerTeam !== 1 && winnerTeam !== 2) ||
      !winnerName
    ) {
      skipped += 1;
      continue;
    }

    const eventKey = publicMatchEventKey({
      serverKey,
      endedAt,
      layerName,
      score1,
      score2,
    });

    try {
      await prisma.publicMatch.upsert({
        where: { eventKey },
        create: {
          serverKey,
          endedAt,
          mapName,
          layerName,
          faction1,
          faction1Side: raw.faction1Side
            ? String(raw.faction1Side).trim()
            : null,
          score1,
          faction2,
          faction2Side: raw.faction2Side
            ? String(raw.faction2Side).trim()
            : null,
          score2,
          winnerTeam,
          winnerName,
          eventKey,
        },
        update: {},
      });
      accepted += 1;
    } catch {
      skipped += 1;
    }
  }

  return NextResponse.json({ ok: true, accepted, skipped });
}
