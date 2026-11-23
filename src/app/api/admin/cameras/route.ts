import { NextResponse } from "next/server";
import { requirePanelkaAccess } from "@/lib/requireAdmin";
import {
  grantPublicCamera,
  listPublicCameras,
  revokePublicCamera,
} from "@/lib/panelkaCameras";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STEAM_RE = /^7656\d{13}$/;

export async function GET(req: Request) {
  const { error } = await requirePanelkaAccess();
  if (error) return error;
  try {
    const steamId = new URL(req.url).searchParams.get("steamId") || "";
    const cameras = await listPublicCameras();
    if (STEAM_RE.test(steamId)) {
      return NextResponse.json({
        ok: true,
        cameras,
        count: cameras.length,
        has: cameras.some((c) => c.steamId === steamId),
        steamId,
      });
    }
    return NextResponse.json({ ok: true, cameras, count: cameras.length });
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
    note?: string;
  } | null;
  const action = body?.action || "";
  const steamId = String(body?.steamId || "").trim();
  const byNick =
    String(session?.user?.nick || session?.user?.name || "штаб").trim().slice(0, 32) ||
    "штаб";
  const bySteamId = session?.user?.steamId || "";

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
      const res = await grantPublicCamera({
        steamId,
        nick,
        byNick,
        bySteamId,
        note: body?.note,
      });
      if (!res.ok) return NextResponse.json(res, { status: 400 });
      const cameras = await listPublicCameras();
      return NextResponse.json({ ok: true, reply: "камера выдана", cameras });
    }
    if (action === "revoke") {
      if (!STEAM_RE.test(steamId)) {
        return NextResponse.json({ ok: false, error: "укажи Steam ID" }, { status: 400 });
      }
      const res = await revokePublicCamera({ steamId });
      if (!res.ok) return NextResponse.json(res, { status: 400 });
      const cameras = await listPublicCameras();
      return NextResponse.json({ ok: true, reply: "камера снята", cameras });
    }
    return NextResponse.json({ ok: false, error: "неизвестное действие" }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "ошибка";
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
