import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  canAccessKeechHunt,
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
  const match = live.match;
  const split = match ? splitEvents(match.events || []) : null;

  return NextResponse.json({
    updatedAt: live.updatedAt,
    match,
    columns: split
      ? {
          kills: split.kills,
          deaths: split.deaths,
          revives: split.revives,
          net: match?.net ?? 0,
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
