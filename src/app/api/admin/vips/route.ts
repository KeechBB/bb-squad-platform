import { NextResponse } from "next/server";
import { requirePanelkaAccess } from "@/lib/requireAdmin";
import {
  grantPublicVip,
  listPublicVips,
  revokePublicVip,
} from "@/lib/panelkaVipBan";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STEAM_RE = /^7656\d{13}$/;

export async function GET() {
  const { error } = await requirePanelkaAccess();
  if (error) return error;
  try {
    const vips = await listPublicVips();
    return NextResponse.json({ ok: true, vips, count: vips.length });
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
    nick?: string;
    startsAt?: string;
    endsAt?: string;
    forever?: boolean;
    note?: string;
  } | null;
  const action = body?.action || "";
  const steamId = String(body?.steamId || "").trim();
  const byNick =
    String(session?.user?.nick || session?.user?.name || "штаб").trim().slice(0, 32) ||
    "штаб";
  const bySteamId = session?.user?.steamId || "";
  const byUserId = (session?.user as { id?: string } | undefined)?.id || null;

  try {
    if (action === "grant") {
      if (!STEAM_RE.test(steamId)) {
        return NextResponse.json({ ok: false, error: "укажи Steam ID" }, { status: 400 });
      }
      let nick = String(body?.nick || "").trim();
      if (!nick) {
        const user = await prisma.user.findFirst({
          where: { steamId },
          select: { nick: true, steamName: true },
        });
        nick = (user?.nick || user?.steamName || "").trim();
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
      const res = await grantPublicVip({
        steamId,
        nick,
        startsAt,
        endsAt,
        forever,
        byNick,
        bySteamId,
        byUserId,
        note: body?.note,
      });
      if (!res.ok) return NextResponse.json(res, { status: 400 });
      const vips = await listPublicVips();
      return NextResponse.json({ ok: true, reply: "випка выдана", vips });
    }
    if (action === "revoke") {
      if (!STEAM_RE.test(steamId)) {
        return NextResponse.json({ ok: false, error: "укажи Steam ID" }, { status: 400 });
      }
      const res = await revokePublicVip({ steamId, byNick });
      if (!res.ok) return NextResponse.json(res, { status: 400 });
      const vips = await listPublicVips();
      return NextResponse.json({ ok: true, reply: "випка снята", vips });
    }
    return NextResponse.json({ ok: false, error: "неизвестное действие" }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "ошибка";
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
