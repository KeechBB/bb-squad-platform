import { NextResponse } from "next/server";
import {
  ensureOpponentClan,
  type OppPlayerIn,
} from "@/lib/opponentClan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(req: Request): boolean {
  const secret = process.env.SQUAD_INGEST_SECRET?.trim();
  if (!secret) return false;
  const auth = req.headers.get("authorization") || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  return bearer === secret;
}

export async function POST(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  const opp = String((body as { opp?: string }).opp || "").trim();
  if (!opp) {
    return NextResponse.json({ error: "opp required" }, { status: 400 });
  }

  const rawPlayers = (body as { players?: unknown }).players;
  const players: OppPlayerIn[] = [];
  if (Array.isArray(rawPlayers)) {
    for (const p of rawPlayers) {
      if (!p || typeof p !== "object") continue;
      const nick = String((p as { nick?: string }).nick || "").trim();
      if (!nick) continue;
      players.push({
        nick,
        steamId: (p as { steamId?: string }).steamId || null,
        matchId: (p as { matchId?: string }).matchId || null,
      });
    }
  }

  const leaderNick = String(
    (body as { leaderNick?: string }).leaderNick || ""
  ).trim();

  const result = await ensureOpponentClan({
    opp,
    players,
    leaderNick: leaderNick || null,
  });
  return NextResponse.json(result);
}
