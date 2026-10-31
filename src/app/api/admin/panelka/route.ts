import { NextResponse } from "next/server";
import { requireSiteVisitsAccess } from "@/lib/requireAdmin";
import { isPanelkaKey, runPanelka } from "@/lib/panelkaRcon";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACTIONS = new Set([
  "restart",
  "end",
  "change-now",
  "change-next",
  "kick",
  "team",
  "say",
]);

export async function GET(req: Request) {
  const { error } = await requireSiteVisitsAccess();
  if (error) return error;
  const url = new URL(req.url);
  const op = url.searchParams.get("op") || "status";
  try {
    if (op === "status") {
      const data = await runPanelka(["status"], 40000);
      return NextResponse.json(data);
    }
    if (op === "players" || op === "roster") {
      const key = url.searchParams.get("key") || "";
      if (!isPanelkaKey(key)) {
        return NextResponse.json({ ok: false, error: "нет такого сервера" }, { status: 400 });
      }
      const data = await runPanelka([op, key], 25000);
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
    return NextResponse.json({ ok: false, error: "неизвестный запрос" }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "ошибка";
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}

export async function POST(req: Request) {
  const { error } = await requireSiteVisitsAccess();
  if (error) return error;
  const body = (await req.json().catch(() => null)) as {
    key?: string;
    action?: string;
    layer?: string;
    steamId?: string;
    message?: string;
  } | null;
  const key = body?.key || "";
  const action = body?.action || "";
  const layer = action === "say" ? (body?.message || "").trim() : body?.layer || "";
  const steamId = body?.steamId || "";
  if (!isPanelkaKey(key) || !ACTIONS.has(action)) {
    return NextResponse.json({ ok: false, error: "нельзя так" }, { status: 400 });
  }
  if (
    (action === "change-now" || action === "change-next") &&
    !/^[A-Za-z0-9_]+$/.test(layer)
  ) {
    return NextResponse.json({ ok: false, error: "карта не из списка" }, { status: 400 });
  }
  if ((action === "kick" || action === "team") && !/^7656\d{13}$/.test(steamId)) {
    return NextResponse.json({ ok: false, error: "нет Steam ID" }, { status: 400 });
  }
  if (action === "say" && (layer.length < 1 || layer.length > 160)) {
    return NextResponse.json({ ok: false, error: "напиши короткое сообщение" }, { status: 400 });
  }
  try {
    const data = await runPanelka(["cmd", key, action, layer, steamId]);
    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "ошибка";
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
