import { NextResponse } from "next/server";
import { requirePanelkaAccess } from "@/lib/requireAdmin";
import {
  durationFromRange,
  listServerBans,
  recordBanAudit,
  unbanServerTarget,
} from "@/lib/panelkaVipBan";
import { runPanelka } from "@/lib/panelkaRcon";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STEAM_RE = /^7656\d{13}$/;

function cleanReason(raw: unknown, limit = 160): string {
  return String(raw || "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

export async function GET() {
  const { error } = await requirePanelkaAccess();
  if (error) return error;
  try {
    const bans = await listServerBans();
    return NextResponse.json({ ok: true, bans, count: bans.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : "ошибка";
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}

export async function POST(req: Request) {
  const { session, error } = await requirePanelkaAccess();
  if (error) return error;
  const body = (await req.json().catch(() => null)) as {
    action?: string;
    steamId?: string;
    targetId?: string;
    reason?: string;
    startsAt?: string;
    endsAt?: string;
    forever?: boolean;
    nick?: string;
  } | null;
  const action = body?.action || "";
  const byNick =
    String(session?.user?.nick || session?.user?.name || "штаб").trim().slice(0, 32) ||
    "штаб";
  const bySteamId = session?.user?.steamId || "";

  try {
    if (action === "unban") {
      const targetId = String(body?.targetId || body?.steamId || "").trim();
      const unbanIds = Array.isArray((body as { unbanIds?: unknown })?.unbanIds)
        ? ((body as { unbanIds: unknown[] }).unbanIds || [])
            .map((x) => String(x || "").trim())
            .filter(Boolean)
        : undefined;
      const res = await unbanServerTarget({ targetId, unbanIds, byNick, bySteamId });
      if (!res.ok) return NextResponse.json(res, { status: 400 });
      const bans = await listServerBans();
      return NextResponse.json({ ok: true, reply: "бан снят", bans });
    }
    if (action === "ban") {
      const steamId = String(body?.steamId || "").trim();
      if (!STEAM_RE.test(steamId)) {
        return NextResponse.json({ ok: false, error: "укажи Steam ID" }, { status: 400 });
      }
      const reason = cleanReason(body?.reason, 160);
      if (reason.length < 2) {
        return NextResponse.json({ ok: false, error: "укажи причину" }, { status: 400 });
      }
      const forever = Boolean(body?.forever);
      const startsAt = body?.startsAt ? new Date(body.startsAt) : new Date();
      const endsAt = forever || !body?.endsAt ? null : new Date(body.endsAt);
      if (Number.isNaN(startsAt.getTime())) {
        return NextResponse.json({ ok: false, error: "плохая дата «от»" }, { status: 400 });
      }
      if (endsAt && Number.isNaN(endsAt.getTime())) {
        return NextResponse.json({ ok: false, error: "плохая дата «до»" }, { status: 400 });
      }
      const duration = durationFromRange(startsAt, endsAt, forever);
      const data = (await runPanelka(["cmd", "PB1", "ban", "", steamId], 35000, {
        reason,
        duration,
        byNick,
        bySteamId,
        targetName: cleanReason(body?.nick || "", 48),
      })) as { ok?: boolean; error?: string; reply?: string };
      if (!data?.ok) {
        return NextResponse.json(
          { ok: false, error: data?.error || "бан не ушёл на сервер" },
          { status: 502 }
        );
      }
      await recordBanAudit({
        steamId,
        reason,
        duration,
        endsAt,
        forever,
        byNick,
        bySteamId,
      });
      // Squad often stores :0 even for timed bans — stamp our meta into Bans.cfg.
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
      const bans = await listServerBans();
      return NextResponse.json({
        ok: true,
        reply: data.reply || "бан выдан",
        bans,
      });
    }
    return NextResponse.json({ ok: false, error: "неизвестное действие" }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "ошибка";
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
