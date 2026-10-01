import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  buildCompareSide,
  listComparableNicks,
} from "@/lib/playerCompare";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.steamId) {
    return NextResponse.json({ error: "auth" }, { status: 401 });
  }

  const url = req.nextUrl;
  const list = url.searchParams.get("list");
  if (list === "1" || list === "nicks") {
    const nicks = await listComparableNicks();
    return NextResponse.json({ nicks });
  }

  const me = String(url.searchParams.get("me") || "").trim();
  const other = String(url.searchParams.get("other") || "").trim();
  const from = String(url.searchParams.get("from") || "").trim() || null;
  const to = String(url.searchParams.get("to") || "").trim() || null;
  if (!me || !other) {
    return NextResponse.json(
      { error: "me and other required" },
      { status: 400 }
    );
  }

  const [left, right] = await Promise.all([
    buildCompareSide(me, { from, to }),
    buildCompareSide(other, { from, to }),
  ]);
  if (!left || !right) {
    return NextResponse.json(
      { error: "player not found" },
      { status: 404 }
    );
  }

  return NextResponse.json({
    from,
    to,
    me: left,
    other: right,
  });
}
