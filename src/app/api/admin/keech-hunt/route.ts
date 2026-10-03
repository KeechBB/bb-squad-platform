import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  canAccessKeechHunt,
  mergeKeechHuntEvents,
  openKeechHuntMatches,
  readKeechHuntLive,
  readKeechHuntMemory,
  splitEvents,
} from "@/lib/keechHunt";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const session = await getSession();
  const steamId = session?.user?.steamId;
  if (!canAccessKeechHunt(steamId)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const [live, memory] = await Promise.all([
    readKeechHuntLive(),
    readKeechHuntMemory(),
  ]);
  const matches = openKeechHuntMatches(live);
  const events = mergeKeechHuntEvents(matches);
  const split = events.length ? splitEvents(events) : null;
  const net = events.reduce((s, e) => s + (Number(e.delta) || 0), 0);
  const primary = live.match || matches[0] || null;

  return NextResponse.json({
    updatedAt: live.updatedAt,
    match: primary
      ? {
          ...primary,
          net: Math.round(net * 10) / 10,
          kills: split?.kills.length ?? 0,
          deaths: split?.deaths.length ?? 0,
          revives: split?.revives.length ?? 0,
          events,
        }
      : null,
    matches: matches.map((m) => ({
      id: m.id,
      server: m.server,
      layerShort: m.layerShort,
      startAt: m.startAt,
      kills: m.kills,
      deaths: m.deaths,
      revives: m.revives,
      net: m.net,
    })),
    columns: split
      ? {
          kills: split.kills,
          deaths: split.deaths,
          revives: split.revives,
          net: Math.round(net * 10) / 10,
        }
      : null,
    history: memory.map((m) => ({
      id: m.id,
      server: m.server,
      layerShort: m.layerShort,
      startAt: m.startAt,
      endAt: m.endAt,
      net: m.net,
      kills: m.kills,
      deaths: m.deaths,
      revives: m.revives,
    })),
  });
}
