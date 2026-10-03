import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  canAccessKeechHunt,
  eventsForMatch,
  openKeechHuntMatches,
  readKeechHuntLive,
  readKeechHuntMemory,
  splitEvents,
  type KeechHuntMatch,
} from "@/lib/keechHunt";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** Most recently active open match = current map on the server Keech is on. */
function pickPrimary(
  liveMatch: KeechHuntMatch | null,
  open: KeechHuntMatch[]
): KeechHuntMatch | null {
  if (!open.length) return null;
  if (liveMatch && open.some((m) => m.id === liveMatch.id)) {
    return open.find((m) => m.id === liveMatch.id) || liveMatch;
  }
  return open.reduce((best, m) => {
    const last = (ev: KeechHuntMatch) => {
      const events = ev.events || [];
      if (events.length) return String(events[events.length - 1]?.at || "");
      return String(ev.startAt || "");
    };
    return last(m) > last(best) ? m : best;
  });
}

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
  // Right columns + live-log + NET: only current map (not PB1+TR1 merged).
  const primary = pickPrimary(live.match, matches);
  const events = eventsForMatch(primary).map((e) => ({
    ...e,
    server: e.server || primary?.server,
    layerShort: e.layerShort || primary?.layerShort,
  }));
  const split = events.length ? splitEvents(events) : null;
  const net =
    Math.round(
      events.reduce((s, e) => s + (Number(e.delta) || 0), 0) * 10
    ) / 10;

  return NextResponse.json({
    updatedAt: live.updatedAt,
    match: primary
      ? {
          ...primary,
          net,
          noks: split?.noks.length ?? primary.noks ?? 0,
          kills: split?.kills.length ?? primary.kills ?? 0,
          deaths: split?.deaths.length ?? primary.deaths ?? 0,
          revives: split?.revives.length ?? primary.revives ?? 0,
          events,
        }
      : null,
    matches: matches.map((m) => ({
      id: m.id,
      server: m.server,
      layerShort: m.layerShort,
      startAt: m.startAt,
      noks: m.noks ?? 0,
      kills: m.kills,
      deaths: m.deaths,
      revives: m.revives,
      net: m.net,
      active: primary ? m.id === primary.id : false,
    })),
    columns: split
      ? {
          noks: split.noks,
          kills: split.kills,
          deaths: split.deaths,
          revives: split.revives,
          net,
        }
      : null,
    history: memory.map((m) => ({
      id: m.id,
      server: m.server,
      layerShort: m.layerShort,
      startAt: m.startAt,
      endAt: m.endAt,
      net: m.net,
      noks: m.noks ?? (m.events || []).filter((e) => e.kind === "nok").length,
      kills: m.kills,
      deaths: m.deaths,
      revives: m.revives,
    })),
  });
}
