import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  canAccessKeechHunt,
  eventsForMatch,
  readKeechHuntMatch,
  splitEvents,
} from "@/lib/keechHunt";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const session = await getSession();
  if (!canAccessKeechHunt(session?.user?.steamId)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { id } = await ctx.params;
  const match = await readKeechHuntMatch(decodeURIComponent(id));
  if (!match) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const events = eventsForMatch(match);
  const split = splitEvents(events);
  const net =
    Math.round(events.reduce((s, e) => s + (Number(e.delta) || 0), 0) * 10) / 10;
  return NextResponse.json({
    match: {
      ...match,
      events,
      net,
      noks: split.noks.length,
      kills: split.kills.length,
      deaths: split.deaths.length,
      revives: split.revives.length,
    },
    columns: {
      noks: split.noks,
      kills: split.kills,
      deaths: split.deaths,
      revives: split.revives,
      net,
    },
  });
}
