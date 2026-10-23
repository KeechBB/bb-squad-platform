import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { getSession } from "@/lib/auth";
import { isBuiltinSuperAdmin } from "@/lib/admin";
import { prisma } from "@/lib/prisma";
import { findBlackberryClanIds } from "@/lib/reserve";
import {
  buildBbSapperRating,
  type BbSapperRatingBoard,
} from "@/lib/fobMinesLab";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function cachePath(): string {
  return path.join(process.cwd(), "data", "tm", "sapper-rating-tr.json");
}

function writeCache(board: BbSapperRatingBoard) {
  try {
    const p = cachePath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(board, null, 2), "utf8");
  } catch {
    /* ignore */
  }
}

/** Keech-only: рейтинг мин BB из логов TR1/TR2 (паблик не трогаем). */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!isBuiltinSuperAdmin(session?.user?.steamId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const sp = req.nextUrl.searchParams;
  const server = (sp.get("server") || "all").toUpperCase();
  // 0 = все логи TR*; паблик (TPUB1) никогда не в списке
  const filesRaw = Number(sp.get("files"));
  const files =
    Number.isFinite(filesRaw) && filesRaw >= 0 ? Math.min(80, filesRaw) : 0;
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

  writeCache(board);

  return NextResponse.json(board, {
    headers: { "Cache-Control": "no-store" },
  });
}
