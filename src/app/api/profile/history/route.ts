import { NextResponse } from "next/server";
import {
  isProfileHistoryKind,
  pageProfileLines,
  rebuildAllPublicLines,
} from "@/lib/profileMatchLines";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const nick = url.searchParams.get("nick")?.trim() || "";
  const kind = url.searchParams.get("kind")?.trim() || "";
  const page = Number(url.searchParams.get("page") || "1");
  const pageSize = Number(url.searchParams.get("pageSize") || "15");
  if (!nick || !isProfileHistoryKind(kind)) {
    return NextResponse.json(
      { error: "nick and kind required" },
      { status: 400 }
    );
  }
  try {
    const data = await pageProfileLines(nick, kind, page, pageSize);
    return NextResponse.json(data, {
      headers: { "Cache-Control": "private, max-age=30" },
    });
  } catch (e) {
    console.warn("[profile/history]", e);
    return NextResponse.json({ error: "history unavailable" }, { status: 500 });
  }
}

/** One-shot fill of public rows. Called by the server after a score update. */
export async function POST(req: Request) {
  const secret = process.env.SQUAD_INGEST_SECRET?.trim();
  const auth = req.headers.get("authorization") || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!secret || bearer !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const players = await rebuildAllPublicLines();
    return NextResponse.json({ players });
  } catch (e) {
    console.warn("[profile/history] fill", e);
    return NextResponse.json({ error: "fill failed" }, { status: 500 });
  }
}
