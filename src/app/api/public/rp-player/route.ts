import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { lookupPlayerPublicRp } from "@/lib/publicRp";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await getSession();
  if (!session?.user?.steamId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const nick = new URL(req.url).searchParams.get("nick")?.trim() || "";
  if (!nick) {
    return NextResponse.json({ error: "nick required" }, { status: 400 });
  }
  const player = await lookupPlayerPublicRp(nick, { full: true });
  return NextResponse.json({ player });
}
