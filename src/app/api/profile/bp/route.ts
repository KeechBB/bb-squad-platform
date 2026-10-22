import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { BP_LEVELS, BP_SEASON } from "@/lib/battlePass";
import { loadBattlePassState, progressForNick } from "@/lib/battlePassData";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Прогресс Battle Pass для вкладки профиля. */
export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.steamId || !session.user.profileComplete) {
    return NextResponse.json({ error: "auth" }, { status: 401 });
  }

  const nick = new URL(req.url).searchParams.get("nick")?.trim() || "";
  if (!nick) {
    return NextResponse.json({ error: "nick" }, { status: 400 });
  }

  const state = await loadBattlePassState();
  const prog = progressForNick(state, nick);
  const level = BP_LEVELS.find((l) => l.level === prog.currentLevel) || BP_LEVELS[0];

  return NextResponse.json({
    ok: true,
    season: BP_SEASON.subtitle,
    level: prog.currentLevel,
    title: level.title,
    task: level.task,
    unit: level.unit,
    current: prog.current,
    target: prog.target,
    done: Boolean(prog.completedAt),
    maxLevel: BP_LEVELS.length,
  });
}
