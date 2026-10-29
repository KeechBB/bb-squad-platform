import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { buildPlayerPublicCombatStats } from "@/lib/publicCombat";
import { lookupPlayerPublicRp } from "@/lib/publicRp";
import { lookupPlayerTrainPwr } from "@/lib/homeTrainPwr";
import { readStoredProfileView } from "@/lib/profileViewSnapshot";

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
  "Cache-Control": "private, max-age=30, stale-while-revalidate=120",
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

  // Календарь, стата, истории — готовый файл. Пересчёт здесь не запускается.
  const payload = await readStoredProfileView(nick);

  if (part === "stats") {
    return NextResponse.json(
      {
        trainPwr: payload.trainPwr,
        publicSummary: payload.publicSummary,
        stats: payload.stats,
      },
      { headers: hdr }
    );
  }

  if (part === "hist") {
    return NextResponse.json({ histories: payload.histories }, { headers: hdr });
  }

  if (part === "training") {
    return NextResponse.json(
      {
        training: payload.training,
        publicAtt: payload.publicAtt,
        cwAtt: payload.cwAtt,
      },
      { headers: hdr }
    );
  }

  return NextResponse.json(payload, { headers: hdr });
}
