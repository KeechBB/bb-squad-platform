import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePanelkaAccess } from "@/lib/requireAdmin";
import { isPanelkaKey, runPanelka } from "@/lib/panelkaRcon";
import {
  listSteamNickHistory,
  recordSteamNicks,
} from "@/lib/steamNickHistory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACTIONS = new Set([
  "restart",
  "end",
  "change-now",
  "change-next",
  "kick",
  "ban",
  "team",
  "unsquad",
  "disband-squad",
  "rename-squad",
  "warn",
  "say",
  "mod-install",
  "mod-remove",
]);
const TEAM_ID_RE = /^[12]$/;
const SQUAD_ID_RE = /^\d{1,3}$/;

const STEAM_RE = /^7656\d{13}$/;
const DURATION_RE = /^(0|\d+[mhd])$/i;
const FACTION_RE = /^(WPMC|TLF|USMC|GFI|USA|RGF|CRF|VDV|CAF|MEI|BAF|IMF|ADF|PLA)$/;
const DECK_RE = /^(AirAssault|Armored|LightInfantry|Mechanized|Motorized|Support)$/;

function cleanReason(raw: unknown, limit = 120): string {
  return String(raw || "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

function formatHours(totalMinutes: number): string {
  const minutes = Math.max(0, Math.round(totalMinutes));
  if (minutes < 60) return `${minutes} мин`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (rest === 0) return `${hours} ч`;
  return `${hours} ч ${rest} мин`;
}

async function siteProfile(steamId: string) {
  const user = await prisma.user.findFirst({
    where: { steamId, profileComplete: true },
    select: {
      id: true,
      nick: true,
      steamId: true,
      factionMembership: {
        select: {
          faction: { select: { name: true, slug: true } },
        },
      },
    },
  });

  const sessions = await prisma.squadServerSession.findMany({
    where: {
      steamId,
      leftAt: { not: null },
      serverKey: { in: ["TPUB1", "PB1", "TPUB", "PUBLIC"] },
    },
    select: { joinedAt: true, leftAt: true },
    orderBy: { joinedAt: "desc" },
    take: 4000,
  });

  let totalMinutes = 0;
  for (const row of sessions) {
    if (!row.leftAt) continue;
    totalMinutes += Math.max(
      0,
      (row.leftAt.getTime() - row.joinedAt.getTime()) / 60000
    );
  }

  return {
    found: Boolean(user),
    nick: user?.nick || null,
    steamId,
    profileUrl: `/players/${encodeURIComponent(steamId)}`,
    steamUrl: `https://steamcommunity.com/profiles/${encodeURIComponent(steamId)}`,
    faction: user?.factionMembership?.faction?.name || null,
    factionSlug: user?.factionMembership?.faction?.slug || null,
    publicHoursLabel: formatHours(totalMinutes),
    publicMinutes: Math.round(totalMinutes),
    sessions: sessions.length,
  };
}

export async function GET(req: Request) {
  const { error } = await requirePanelkaAccess();
  if (error) return error;
  const url = new URL(req.url);
  const op = url.searchParams.get("op") || "status";
  try {
    if (op === "status") {
      const key = url.searchParams.get("key") || "";
      if (key) {
        if (!isPanelkaKey(key)) {
          return NextResponse.json({ ok: false, error: "нет такого сервера" }, { status: 400 });
        }
        const data = await runPanelka(["status", key], 25000);
        return NextResponse.json(data);
      }
      const data = await runPanelka(["status"], 55000);
      return NextResponse.json(data);
    }
    if (op === "players" || op === "roster") {
      const key = url.searchParams.get("key") || "";
      if (!isPanelkaKey(key)) {
        return NextResponse.json({ ok: false, error: "нет такого сервера" }, { status: 400 });
      }
      const data = (await runPanelka([op, key], 25000)) as {
        ok?: boolean;
        teams?: {
          squads?: { players?: { steamId?: string; name?: string }[] }[];
          loose?: { steamId?: string; name?: string }[];
        }[];
      };
      // Passive nick history: every roster open remembers who played as whom
      if (data?.ok && Array.isArray(data.teams)) {
        const sightings: { steamId: string; nick: string; source: string }[] = [];
        for (const team of data.teams) {
          for (const squad of team.squads || []) {
            for (const p of squad.players || []) {
              if (p.steamId && p.name) {
                sightings.push({ steamId: p.steamId, nick: p.name, source: "panelka" });
              }
            }
          }
          for (const p of team.loose || []) {
            if (p.steamId && p.name) {
              sightings.push({ steamId: p.steamId, nick: p.name, source: "panelka" });
            }
          }
        }
        if (sightings.length) {
          void recordSteamNicks(sightings).catch(() => undefined);
        }
      }
      return NextResponse.json(data);
    }
    if (op === "layers") {
      const data = await runPanelka(["layers"], 45000);
      return NextResponse.json(data);
    }
    if (op === "chat") {
      const key = url.searchParams.get("key") || "";
      if (!isPanelkaKey(key)) {
        return NextResponse.json({ ok: false, error: "нет такого сервера" }, { status: 400 });
      }
      const data = await runPanelka(["chat", key], 20000);
      return NextResponse.json(data);
    }
    if (op === "player-card") {
      const key = url.searchParams.get("key") || "";
      const steamId = url.searchParams.get("steamId") || "";
      const name = url.searchParams.get("name") || "";
      if (!isPanelkaKey(key) || !STEAM_RE.test(steamId)) {
        return NextResponse.json({ ok: false, error: "нет игрока" }, { status: 400 });
      }
      const profile = await siteProfile(steamId);
      const nickHistory = await listSteamNickHistory(steamId, name).catch(() => []);
      try {
        const history = (await runPanelka(["player-card", key, steamId], 28000, {
          name,
        })) as {
          ok?: boolean;
          chat?: unknown[];
          teamkills?: unknown[];
          punishments?: unknown[];
          error?: string;
        };
        if (!history?.ok) {
          return NextResponse.json({
            ok: true,
            profile,
            nickHistory,
            chat: [],
            teamkills: [],
            punishments: [],
            warning: history?.error || "история с сервера не пришла",
          });
        }
        return NextResponse.json({
          ok: true,
          profile,
          nickHistory,
          chat: history.chat || [],
          teamkills: history.teamkills || [],
          punishments: history.punishments || [],
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "ошибка";
        return NextResponse.json({
          ok: true,
          profile,
          nickHistory,
          chat: [],
          teamkills: [],
          punishments: [],
          warning: `история не успела: ${message.slice(0, 120)}`,
        });
      }
    }
    if (op === "mods") {
      const key = url.searchParams.get("key") || "";
      if (!isPanelkaKey(key)) {
        return NextResponse.json({ ok: false, error: "нет такого сервера" }, { status: 400 });
      }
      const data = await runPanelka(["mods", key], 45000);
      return NextResponse.json(data);
    }
    if (op === "staff-log") {
      const limitRaw = Number(url.searchParams.get("limit") || "400");
      const limit = Math.min(800, Math.max(50, Number.isFinite(limitRaw) ? limitRaw : 400));
      const data = await runPanelka(["staff-log"], 25000, { limit });
      return NextResponse.json(data);
    }
    return NextResponse.json({ ok: false, error: "неизвестный запрос" }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "ошибка";
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}

export async function POST(req: Request) {
  const { session, error } = await requirePanelkaAccess();
  if (error) return error;
  const body = (await req.json().catch(() => null)) as {
    key?: string;
    action?: string;
    layer?: string;
    steamId?: string;
    message?: string;
    reason?: string;
    duration?: string;
    faction1?: string;
    faction2?: string;
    deck1?: string;
    deck2?: string;
    mod?: string;
    modId?: string;
    targetName?: string;
    teamId?: string;
    squadId?: string;
    squadName?: string;
  } | null;
  const key = body?.key || "";
  const action = body?.action || "";
  const layer =
    action === "say" || action === "warn"
      ? cleanReason(body?.message || body?.reason || "", 160)
      : body?.layer || "";
  const steamId = body?.steamId || "";
  const reason = cleanReason(body?.reason || body?.message || "");
  const duration = String(body?.duration || "").trim();
  const faction1 = String(body?.faction1 || "").trim().toUpperCase();
  const faction2 = String(body?.faction2 || "").trim().toUpperCase();
  const deck1 = String(body?.deck1 || "").trim();
  const deck2 = String(body?.deck2 || "").trim();
  const modRaw = String(body?.mod || body?.modId || "").trim();
  const teamId = String(body?.teamId || "").trim();
  const squadId = String(body?.squadId || "").trim();
  const squadName = cleanReason(body?.squadName || "", 48);

  if (!isPanelkaKey(key) || !ACTIONS.has(action)) {
    return NextResponse.json({ ok: false, error: "нельзя так" }, { status: 400 });
  }
  if (
    (action === "change-now" || action === "change-next") &&
    !/^[A-Za-z0-9_]+$/.test(layer)
  ) {
    return NextResponse.json({ ok: false, error: "карта не из списка" }, { status: 400 });
  }
  if (action === "change-now" || action === "change-next") {
    const anyFaction = Boolean(faction1 || faction2 || deck1 || deck2);
    if (anyFaction) {
      if (!FACTION_RE.test(faction1) || !FACTION_RE.test(faction2)) {
        return NextResponse.json({ ok: false, error: "выбери фракции обеих команд" }, { status: 400 });
      }
      if (faction1 === faction2) {
        return NextResponse.json({ ok: false, error: "фракции команд должны отличаться" }, { status: 400 });
      }
      if ((deck1 && !DECK_RE.test(deck1)) || (deck2 && !DECK_RE.test(deck2))) {
        return NextResponse.json({ ok: false, error: "неизвестная дека" }, { status: 400 });
      }
    }
  }
  if (
    (action === "kick" ||
      action === "ban" ||
      action === "team" ||
      action === "unsquad" ||
      action === "warn") &&
    !STEAM_RE.test(steamId)
  ) {
    return NextResponse.json({ ok: false, error: "нет Steam ID" }, { status: 400 });
  }
  if (action === "say" && (layer.length < 1 || layer.length > 160)) {
    return NextResponse.json({ ok: false, error: "напиши короткое сообщение" }, { status: 400 });
  }
  if (action === "kick" && reason.length < 2) {
    return NextResponse.json({ ok: false, error: "укажи причину кика" }, { status: 400 });
  }
  if (action === "ban") {
    if (reason.length < 2) {
      return NextResponse.json({ ok: false, error: "укажи причину бана" }, { status: 400 });
    }
    if (!DURATION_RE.test(duration)) {
      return NextResponse.json(
        { ok: false, error: "срок: число+h / число+d / 0 (навсегда)" },
        { status: 400 }
      );
    }
  }
  if (action === "warn" && reason.length < 1) {
    return NextResponse.json({ ok: false, error: "напиши сообщение игроку" }, { status: 400 });
  }
  if (action === "disband-squad" || action === "rename-squad") {
    if (!TEAM_ID_RE.test(teamId) || !SQUAD_ID_RE.test(squadId)) {
      return NextResponse.json({ ok: false, error: "укажи отряд" }, { status: 400 });
    }
  }
  if ((action === "mod-install" || action === "mod-remove") && modRaw.length < 3) {
    return NextResponse.json({ ok: false, error: "укажи ID мода или ссылку Workshop" }, { status: 400 });
  }
  try {
    if (action === "mod-install") {
      const data = await runPanelka(["mod-install", key], 480000, { mod: modRaw });
      return NextResponse.json(data);
    }
    if (action === "mod-remove") {
      const data = await runPanelka(["mod-remove", key], 60000, { mod: modRaw });
      return NextResponse.json(data);
    }
    const byNick =
      cleanReason(session?.user?.nick || session?.user?.name || "панель", 32) || "панель";
    const data = await runPanelka(["cmd", key, action, layer, steamId], 35000, {
      reason,
      duration,
      faction1,
      faction2,
      deck1,
      deck2,
      byNick,
      bySteamId: session?.user?.steamId || "",
      targetName: cleanReason(body?.targetName || squadName || "", 48),
      teamId,
      squadId,
      squadName,
    });
    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "ошибка";
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
