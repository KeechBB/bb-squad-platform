import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { cwReadyState, toggleReady, viewerIsBlackberry } from "@/lib/cwReady";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await getSession();
  const userId = session?.user?.id || "";
  if (!(await viewerIsBlackberry(userId))) {
    return NextResponse.json({ error: "Только клан BlackBerry" }, { status: 403 });
  }
  const matchId = new URL(req.url).searchParams.get("matchId") || "";
  const state = await cwReadyState(matchId, userId);
  if (!state) {
    return NextResponse.json({ error: "Нет матча" }, { status: 404 });
  }
  return NextResponse.json(state);
}

export async function POST(req: Request) {
  const session = await getSession();
  const userId = session?.user?.id || "";
  if (!(await viewerIsBlackberry(userId))) {
    return NextResponse.json({ error: "Только клан BlackBerry" }, { status: 403 });
  }
  let matchId = "";
  try {
    const body = (await req.json()) as { matchId?: string };
    matchId = String(body.matchId || "");
  } catch {
    matchId = "";
  }
  const nick = String(session?.user?.nick || session?.user?.name || "").trim();
  const result = await toggleReady(matchId, userId, nick);
  if (!result) {
    return NextResponse.json({ error: "Этого матча нет в ближайших" }, { status: 404 });
  }
  return NextResponse.json(result);
}
