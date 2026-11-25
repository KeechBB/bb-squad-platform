import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { lookupPlayerPublicRp } from "@/lib/publicRp";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await getSession();
  if (!session?.user?.steamId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const nick = url.searchParams.get("nick")?.trim() || "";
  const steamRaw = url.searchParams.get("steamId")?.trim() || "";
  const steamId = /^7656\d{13}$/.test(steamRaw) ? steamRaw : "";
  if (!nick) {
    return NextResponse.json({ error: "nick required" }, { status: 400 });
  }

  if (steamId) {
    try {
      const {
        collisionBySteamId,
        publicRpLookupNick,
        ALL_ANGEL_STEAM_IDS,
        loadSteamAngelSpawnMs,
        angelSteamOwnsMatchExclusive,
      } = await import("@/lib/nickCollisions");
      const hit = collisionBySteamId(steamId);
      if (hit && ALL_ANGEL_STEAM_IDS.includes(steamId)) {
        const { buildPlayerPublicCombatStats } = await import(
          "@/lib/publicCombat"
        );
        const [stats, base, plain, mySpawns, rivals] = await Promise.all([
          buildPlayerPublicCombatStats(hit.siteNick, { steamId }),
          lookupPlayerPublicRp(publicRpLookupNick(nick, steamId), {
            full: true,
          }).catch(() => null),
          lookupPlayerPublicRp("angel", { full: true }).catch(() => null),
          loadSteamAngelSpawnMs(steamId, "TPUB"),
          Promise.all(
            ALL_ANGEL_STEAM_IDS.filter((s) => s !== steamId).map(async (s) => ({
              steamId: s,
              spawns: await loadSteamAngelSpawnMs(s, "TPUB"),
            }))
          ),
        ]);
        const source = (plain?.matches?.length ? plain : base) as {
          matches?: Array<{ id?: string; date?: string }>;
        } | null;
        const matches = (source?.matches || []).filter((m) => {
          const id = String(m.id || "");
          const parsed = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})-/.exec(id);
          const date =
            String(m.date || "").slice(0, 10) ||
            (parsed ? `${parsed[1]}-${parsed[2]}-${parsed[3]}` : "");
          const hm = parsed ? `${parsed[4]}:${parsed[5]}` : null;
          if (!date) return false;
          return angelSteamOwnsMatchExclusive(
            steamId,
            mySpawns,
            date,
            hm,
            rivals
          );
        });
        return NextResponse.json(
          {
            player: {
              ...(base || {}),
              nick: hit.siteNick,
              rp: stats?.rp ?? base?.rp ?? null,
              rankLabel: stats?.rankLabel ?? base?.rankLabel ?? null,
              rankKey: stats?.rankKey ?? base?.rankKey ?? null,
              matches,
            },
          },
          {
            headers: {
              "Cache-Control":
                "private, max-age=60, stale-while-revalidate=120",
            },
          }
        );
      }
    } catch {
      /* fallback ниже */
    }
  }

  const player = await lookupPlayerPublicRp(nick, { full: true });
  return NextResponse.json(
    { player },
    {
      headers: {
        "Cache-Control": "private, max-age=60, stale-while-revalidate=120",
      },
    }
  );
}
