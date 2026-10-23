import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { isBuiltinSuperAdmin } from "@/lib/admin";
import { prisma } from "@/lib/prisma";
import { findBlackberryClanIds } from "@/lib/reserve";
import { buildBbSapperRating } from "@/lib/fobMinesLab";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Keech-only: рейтинг BB по минам/FOB из логов TR. */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!isBuiltinSuperAdmin(session?.user?.steamId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const sp = req.nextUrl.searchParams;
  const server = (sp.get("server") || "all").toUpperCase();
  const files = Math.min(12, Math.max(1, Number(sp.get("files") || 5) || 5));
  const servers =
    server === "TR1" || server === "TR2" ? [server] : ["TR1", "TR2"];

  const clanIds = await findBlackberryClanIds();
  const members =
    clanIds.length === 0
      ? []
      : await prisma.clanMember.findMany({
          where: { clanId: { in: clanIds } },
          select: {
            user: { select: { steamId: true, nick: true } },
          },
        });

  const roster = members
    .map((m) => ({
      steamId: m.user.steamId || "",
      nick: (m.user.nick || "").trim() || m.user.steamId || "?",
    }))
    .filter((m) => m.steamId);

  const board = buildBbSapperRating(roster, {
    servers,
    maxFilesPerServer: files,
  });

  return NextResponse.json(board, {
    headers: { "Cache-Control": "no-store" },
  });
}
