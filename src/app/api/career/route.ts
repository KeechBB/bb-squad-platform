import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  buildPlayerCareerFeed,
  emptyPlayerCareerFeed,
} from "@/lib/playerCareerFeed";

export const dynamic = "force-dynamic";

/** GET /api/career?nick=… — career timeline (lazy profile load). */
export async function GET(req: Request) {
  const session = await getSession();
  if (!session?.user?.steamId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const nick = new URL(req.url).searchParams.get("nick")?.trim() || "";
  if (!nick) {
    return NextResponse.json({ error: "nick required" }, { status: 400 });
  }
  try {
    const feed = await buildPlayerCareerFeed(nick);
    return NextResponse.json(feed, {
      headers: { "Cache-Control": "private, max-age=30" },
    });
  } catch {
    return NextResponse.json(emptyPlayerCareerFeed(nick));
  }
}
