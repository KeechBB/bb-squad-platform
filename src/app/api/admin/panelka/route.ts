import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePanelkaAccess } from "@/lib/requireAdmin";
import { isPanelkaKey, runPanelka } from "@/lib/panelkaRcon";
import {
  listSteamNickHistory,
  recordSteamNicks,
} from "@/lib/steamNickHistory";
import {
  addPanelkaLabel,
  addPanelkaNote,
  listPanelkaMemos,
  removePanelkaMemo,
} from "@/lib/panelkaMemos";
import { enrichPanelkaRosterPaint } from "@/lib/panelkaRosterPaint";

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
  "server-restart",
  "camera-add",
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

/** Fast card shell: user + faction only (hours come from PB1 disk cache). */
async function siteProfileLight(steamId: string) {
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

  return {
    found: Boolean(user),
    nick: user?.nick || null,
    steamId,
    profileUrl: `/players/${encodeURIComponent(steamId)}`,
    steamUrl: `https://steamcommunity.com/profiles/${encodeURIComponent(steamId)}`,
    faction: user?.factionMembership?.faction?.name || null,
    factionSlug: user?.factionMembership?.faction?.slug || null,
    publicHoursLabel: "—",
    publicMinutes: 0,
    sessions: 0,
  };
}

async function siteProfile(steamId: string) {
  const base = await siteProfileLight(steamId);
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
    ...base,
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
      // quiet=1 — автополл: без записи ников и без тяжёлой покраски ролей
      const quiet = url.searchParams.get("quiet") === "1";
      let data = (await runPanelka([op, key], 25000)) as {
        ok?: boolean;
        teams?: {
          squads?: {
            players?: {
              steamId?: string;
              name?: string;
              rights?: string;
              clanColor?: string | null;
            }[];
          }[];
          loose?: {
            steamId?: string;
            name?: string;
            rights?: string;
            clanColor?: string | null;
          }[];
        }[];
      };
      // Soft nick history: every roster open remembers who played as whom
      if (!quiet && data?.ok && Array.isArray(data.teams)) {
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
        data = await enrichPanelkaRosterPaint(data);
      }
      return NextResponse.json(data);
    }
    if (op === "leaves") {
      const key = url.searchParams.get("key") || "";
      if (!isPanelkaKey(key)) {
        return NextResponse.json({ ok: false, error: "нет такого сервера" }, { status: 400 });
      }
      // Только живой лог-запись (roster-diff), TTL 30 мин. Без пересборки из БД.
      const data = await runPanelka(["leaves", key], 8000);
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
    // Fast shell: profile + memos + nickHistory + disk PB1. No RCON.
    if (op === "player-card") {
      const steamId = url.searchParams.get("steamId") || "";
      const name = url.searchParams.get("name") || "";
      if (!STEAM_RE.test(steamId)) {
        return NextResponse.json({ ok: false, error: "нет игрока" }, { status: 400 });
      }
      const { readPb1StatsCache, getPanelkaPlayerPb1Stats } = await import(
        "@/lib/panelkaPlayerPb1Stats"
      );
      const disk = readPb1StatsCache(steamId);
      const [profile, nickHistory, memos] = await Promise.all([
        siteProfileLight(steamId),
        listSteamNickHistory(steamId, name).catch(() => []),
        listPanelkaMemos(steamId).catch(() => ({
          notes: [] as [],
          labels: [] as [],
        })),
      ]);
      let pb1Stats = disk?.stats || null;
      let pb1Meta = {
        fromCache: Boolean(disk),
        updatedAt: disk?.updatedAt || null,
      };
      if (pb1Stats) {
        // Fill hours into light profile from cache
        profile.publicHoursLabel = pb1Stats.hoursLabel;
        profile.publicMinutes = pb1Stats.publicMinutes;
        profile.sessions = pb1Stats.sessions;
        const age = Date.now() - Date.parse(disk!.updatedAt);
        if (Number.isFinite(age) && age > 6 * 3600_000) {
          void getPanelkaPlayerPb1Stats({
            steamId,
            nick: profile.nick || name || null,
          }).catch(() => null);
        }
      } else {
        // Miss: rebuild in background, do not block card open
        void getPanelkaPlayerPb1Stats({
          steamId,
          nick: profile.nick || name || null,
        }).catch(() => null);
      }
      return NextResponse.json({
        ok: true,
        profile,
        pb1Stats,
        pb1StatsMeta: pb1Meta,
        nickHistory,
        notes: memos.notes,
        labels: memos.labels,
        chat: [],
        teamkills: [],
        punishments: [],
      });
    }
    // Slow: chat / punishments / teamkills from server logs (RCON helper)
    if (op === "player-history") {
      const key = url.searchParams.get("key") || "";
      const steamId = url.searchParams.get("steamId") || "";
      const name = url.searchParams.get("name") || "";
      if (!isPanelkaKey(key) || !STEAM_RE.test(steamId)) {
        return NextResponse.json({ ok: false, error: "нет игрока" }, { status: 400 });
      }
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
            chat: [],
            teamkills: [],
            punishments: [],
            warning: history?.error || "история с сервера не пришла",
          });
        }
        return NextResponse.json({
          ok: true,
          chat: history.chat || [],
          teamkills: history.teamkills || [],
          punishments: history.punishments || [],
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "ошибка";
        return NextResponse.json({
          ok: true,
          chat: [],
          teamkills: [],
          punishments: [],
          warning: `история не успела: ${message.slice(0, 120)}`,
        });
      }
    }
    // Disk-only PB1 stats (instant paint)
    if (op === "player-pb1-stats") {
      const steamId = url.searchParams.get("steamId") || "";
      const name = url.searchParams.get("name") || "";
      if (!STEAM_RE.test(steamId)) {
        return NextResponse.json({ ok: false, error: "нет игрока" }, { status: 400 });
      }
      const { getPanelkaPlayerPb1Stats, readPb1StatsCache } = await import(
        "@/lib/panelkaPlayerPb1Stats"
      );
      const disk = readPb1StatsCache(steamId);
      if (disk) {
        const age = Date.now() - Date.parse(disk.updatedAt);
        if (Number.isFinite(age) && age < 48 * 3600_000) {
          if (age > 6 * 3600_000) {
            void getPanelkaPlayerPb1Stats({
              steamId,
              nick: disk.nick || name || null,
            }).catch(() => null);
          }
          return NextResponse.json({
            ok: true,
            pb1Stats: disk.stats,
            pb1StatsMeta: { fromCache: true, updatedAt: disk.updatedAt },
          });
        }
      }
      // Miss: do not block — warm async
      void getPanelkaPlayerPb1Stats({
        steamId,
        nick: name || null,
      }).catch(() => null);
      return NextResponse.json({
        ok: true,
        pb1Stats: null,
        pb1StatsMeta: { fromCache: false, updatedAt: null, building: true },
      });
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
    noteId?: string;
    memoId?: string;
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
  const memoId = String(body?.memoId || body?.noteId || "").trim();

  const byNick =
    cleanReason(session?.user?.nick || session?.user?.name || "панель", 32) || "панель";
  const bySteamId = session?.user?.steamId || "";
  const byUserId = (session?.user as { id?: string } | undefined)?.id || null;

  // Notes / labels — DB only, no RCON
  if (
    action === "note-add" ||
    action === "label-add" ||
    action === "note-remove" ||
    action === "label-remove" ||
    action === "memo-remove"
  ) {
    if (!STEAM_RE.test(steamId)) {
      return NextResponse.json({ ok: false, error: "нет Steam ID" }, { status: 400 });
    }
    try {
      if (action === "note-add") {
        const res = await addPanelkaNote({
          steamId,
          text: String(body?.message || body?.reason || ""),
          byNick,
          byUserId,
          bySteamId,
        });
        if (!res.ok) return NextResponse.json(res, { status: 400 });
        const memos = await listPanelkaMemos(steamId);
        return NextResponse.json({ ok: true, reply: "заметка сохранена", ...memos, row: res.row });
      }
      if (action === "label-add") {
        const res = await addPanelkaLabel({
          steamId,
          text: String(body?.message || body?.reason || ""),
          byNick,
          byUserId,
          bySteamId,
        });
        if (!res.ok) return NextResponse.json(res, { status: 400 });
        const memos = await listPanelkaMemos(steamId);
        return NextResponse.json({ ok: true, reply: "ярлык повешен", ...memos, row: res.row });
      }
      if (!memoId) {
        return NextResponse.json({ ok: false, error: "нет id" }, { status: 400 });
      }
      const res = await removePanelkaMemo(memoId, steamId);
      if (!res.ok) return NextResponse.json(res, { status: 400 });
      const memos = await listPanelkaMemos(steamId);
      return NextResponse.json({ ok: true, reply: "удалено", ...memos });
    } catch (err) {
      const message = err instanceof Error ? err.message : "ошибка";
      return NextResponse.json({ ok: false, error: message }, { status: 502 });
    }
  }

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
      action === "warn" ||
      action === "camera-add") &&
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
    if (action === "server-restart") {
      const data = await runPanelka(["server-restart", key], 120000);
      return NextResponse.json(data);
    }
    if (action === "camera-add") {
      const data = await runPanelka(["camera-add", steamId], 30000, {
        byNick,
        bySteamId,
        key,
        name: cleanReason(body?.targetName || "", 48),
        note: reason || "",
        granted: new Date().toISOString().slice(0, 19),
      });
      return NextResponse.json(data);
    }
    const data = (await runPanelka(["cmd", key, action, layer, steamId], 35000, {
      reason,
      duration,
      faction1,
      faction2,
      deck1,
      deck2,
      byNick,
      bySteamId,
      targetName: cleanReason(body?.targetName || squadName || "", 48),
      teamId,
      squadId,
      squadName,
    })) as { ok?: boolean; error?: string; reply?: string };

    // Ban from player card / servers panel must land in Bans table enrichment too.
    if (action === "ban" && data?.ok !== false && STEAM_RE.test(steamId)) {
      const forever = duration === "0";
      let endsAt: Date | null = null;
      if (!forever && /^\d+d$/i.test(duration)) {
        const days = Number(duration.slice(0, -1)) || 1;
        endsAt = new Date(Date.now() + days * 86_400_000);
      } else if (!forever && /^\d+h$/i.test(duration)) {
        const hours = Number(duration.slice(0, -1)) || 1;
        endsAt = new Date(Date.now() + hours * 3_600_000);
      } else if (!forever && /^\d+m$/i.test(duration)) {
        const mins = Number(duration.slice(0, -1)) || 1;
        endsAt = new Date(Date.now() + mins * 60_000);
      }
      const { recordBanAudit } = await import("@/lib/panelkaVipBan");
      await recordBanAudit({
        steamId,
        reason,
        duration,
        endsAt,
        forever,
        byNick,
        bySteamId,
      }).catch(() => null);
      await runPanelka(["ban-annotate", steamId], 25000, {
        until: forever
          ? "forever"
          : endsAt
            ? endsAt.toISOString().slice(0, 19)
            : "forever",
        duration,
        byNick,
        reason,
        at: new Date().toISOString().slice(0, 19),
      }).catch(() => null);
    }

    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "ошибка";
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
