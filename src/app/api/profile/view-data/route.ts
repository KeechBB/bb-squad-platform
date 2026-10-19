import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { loadUserTrainingStats } from "@/lib/trainingStats";
import { loadUserPublicAttendanceStats } from "@/lib/publicAttendance";
import {
  buildPlayerPublicCombatStats,
} from "@/lib/publicCombat";
import { lookupPlayerPublicRp } from "@/lib/publicRp";
import { lookupPlayerTrainPwr } from "@/lib/homeTrainPwr";
import {
  loadPlayerProfileHistories,
  loadPlayerProfileStats,
} from "@/lib/playerProfileHeavy";
import { buildPlayerCwAttendance } from "@/lib/homeCwPwr";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Part =
  | "train-pwr"
  | "public-head"
  | "head"
  | "training"
  | "stats"
  | "hist"
  | "all";

function parsePart(raw: string | null): Part {
  const v = String(raw || "all").trim().toLowerCase();
  if (
    v === "train-pwr" ||
    v === "public-head" ||
    v === "head" ||
    v === "training" ||
    v === "stats" ||
    v === "hist"
  ) {
    return v;
  }
  return "all";
}

const hdr = {
  "Cache-Control": "private, max-age=90, stale-while-revalidate=300",
};

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.steamId || !session.user.profileComplete) {
    return NextResponse.json({ error: "auth" }, { status: 401 });
  }

  const url = new URL(req.url);
  const part = parsePart(url.searchParams.get("part"));
  const nickParam = String(url.searchParams.get("nick") || "").trim();
  const nick = nickParam || session.user.nick || "";

  // Быстрые части — без лишнего prisma.user
  if (part === "train-pwr") {
    const trainPwr = nick
      ? await lookupPlayerTrainPwr(nick).catch(() => null)
      : null;
    return NextResponse.json({ trainPwr }, { headers: hdr });
  }

  if (part === "public-head") {
    // RP из slim ladder (быстро); combat из memo-таблицы
    const [rp, combat] = await Promise.all([
      nick ? lookupPlayerPublicRp(nick).catch(() => null) : null,
      nick ? buildPlayerPublicCombatStats(nick).catch(() => null) : null,
    ]);
    return NextResponse.json(
      { publicSummary: { rp, combat } },
      { headers: hdr }
    );
  }

  if (part === "head") {
    const [trainPwr, rp, combat] = await Promise.all([
      nick ? lookupPlayerTrainPwr(nick).catch(() => null) : null,
      nick ? lookupPlayerPublicRp(nick).catch(() => null) : null,
      nick ? buildPlayerPublicCombatStats(nick).catch(() => null) : null,
    ]);
    return NextResponse.json(
      { trainPwr, publicSummary: { rp, combat } },
      { headers: hdr }
    );
  }

  if (part === "stats") {
    const stats = nick
      ? await loadPlayerProfileStats(nick).catch(() => null)
      : null;
    return NextResponse.json({ stats }, { headers: hdr });
  }

  if (part === "hist") {
    const histories = nick
      ? await loadPlayerProfileHistories(nick).catch(() => null)
      : null;
    return NextResponse.json({ histories }, { headers: hdr });
  }

  // training / all — нужен userId
  const me = await prisma.user.findUnique({
    where: { steamId: session.user.steamId },
    select: { id: true, nick: true },
  });
  if (!me) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const nick2 = nick || me.nick || "";

  if (part === "training") {
    const [training, publicAtt, cwAtt] = await Promise.all([
      loadUserTrainingStats(me.id),
      loadUserPublicAttendanceStats(me.id).catch(() => null),
      nick2
        ? buildPlayerCwAttendance(nick2).catch(() => ({ byDay: {} }))
        : Promise.resolve({ byDay: {} }),
    ]);
    return NextResponse.json({ training, publicAtt, cwAtt }, { headers: hdr });
  }

  const [trainPwr, rp, combat, training, publicAtt, cwAtt, stats, histories] =
    await Promise.all([
      nick2 ? lookupPlayerTrainPwr(nick2).catch(() => null) : null,
      nick2 ? lookupPlayerPublicRp(nick2).catch(() => null) : null,
      nick2 ? buildPlayerPublicCombatStats(nick2).catch(() => null) : null,
      loadUserTrainingStats(me.id),
      loadUserPublicAttendanceStats(me.id).catch(() => null),
      nick2
        ? buildPlayerCwAttendance(nick2).catch(() => ({ byDay: {} }))
        : Promise.resolve({ byDay: {} }),
      nick2 ? loadPlayerProfileStats(nick2).catch(() => null) : null,
      nick2 ? loadPlayerProfileHistories(nick2).catch(() => null) : null,
    ]);

  return NextResponse.json(
    {
      trainPwr,
      publicSummary: { rp, combat },
      training,
      publicAtt,
      cwAtt,
      stats,
      histories,
    },
    { headers: hdr }
  );
}
