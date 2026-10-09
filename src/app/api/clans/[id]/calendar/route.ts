import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  detectCwModeFromText,
  formatLabel,
  isCwMode,
  modeImage,
  modeLabel,
  parseCwFormat,
} from "@/lib/cwChallenge";
import { buildCalendarMatches } from "@/lib/kvForecast";
import type { MatchForecast, UpcomingMatchPreview } from "@/lib/kvForecastUi";
import { canonOpp, clanLogoUrl } from "@/lib/clanLogo";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export type ClanCalMatch = UpcomingMatchPreview & {
  modeId: string;
  modeLabel: string;
  modeImage: string;
  ourLogo: string | null;
  oppLogo: string | null;
  formatLabel: string;
  source: "kv" | "challenge";
};

const EMPTY_FORECAST: MatchForecast = {
  winPct: 50,
  drawPct: 8,
  losePct: 42,
  confidence: "low",
  summary: "Мало сыгранных встреч — прогноз нейтральный, ждём больше данных.",
  factors: [
    {
      label: "Выборка",
      value: "недостаточно матчей для точной модели",
      tone: "neutral",
    },
  ],
};

function enrichPreview(
  p: UpcomingMatchPreview,
  ourLogo: string | null,
  source: "kv" | "challenge"
): ClanCalMatch {
  const modeId = detectCwModeFromText(`${p.map} ${p.rules || ""} ${p.note || ""}`);
  const opp = canonOpp(p.opp);
  const sizeNum = parseCwFormat(p.size);
  const oppLogo =
    clanLogoUrl(opp.key) ||
    clanLogoUrl(p.opp) ||
    clanLogoUrl(opp.tag);
  return {
    ...p,
    modeId,
    modeLabel: modeLabel(modeId),
    modeImage: modeImage(modeId),
    ourLogo,
    oppLogo,
    formatLabel: sizeNum != null ? formatLabel(sizeNum) : "—",
    source,
  };
}

export async function GET(_req: Request, ctx: Ctx) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.steamId || !session.user.profileComplete) {
    return NextResponse.json({ error: "Нужен вход" }, { status: 401 });
  }

  const { id: clanId } = await ctx.params;
  const clan = await prisma.clan.findUnique({
    where: { id: clanId },
    select: { id: true, tag: true, name: true, logoUrl: true },
  });
  if (!clan) {
    return NextResponse.json({ error: "Клан не найден" }, { status: 404 });
  }

  const tagUp = clan.tag.toUpperCase();
  // Для BB всегда файлы из /rating-logos (DB logoUrl часто битый upload)
  const ourLogo =
    tagUp === "BB"
      ? clanLogoUrl("BB-MAIN")
      : clanLogoUrl(tagUp) || clan.logoUrl || null;

  const matches: ClanCalMatch[] = [];

  // BlackBerry: полный KV-календарь с хирургическим прогнозом (форма / карта / h2h)
  if (tagUp === "BB") {
    try {
      const { previews } = await buildCalendarMatches();
      for (const p of previews) {
        const stack = String(p.stack || "").toLowerCase();
        const stackLogo = stack.includes("jun")
          ? clanLogoUrl("BB-JUNIOR")
          : clanLogoUrl("BB-MAIN");
        matches.push(enrichPreview(p, stackLogo, "kv"));
      }
    } catch {
      /* KV optional */
    }
  }

  const events = await prisma.clanCalendarEvent.findMany({
    where: { clanId },
    orderBy: { scheduledAt: "asc" },
    take: 200,
  });

  for (const e of events) {
    const d = new Date(e.scheduledAt);
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Moscow",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(d);
    const n = (t: string) =>
      Number(parts.find((p) => p.type === t)?.value || 0);
    const year = n("year");
    const month = n("month");
    const day = n("day");
    const hh = String(n("hour")).padStart(2, "0");
    const mm = String(n("minute")).padStart(2, "0");
    const modeId = isCwMode(e.mode) ? e.mode : detectCwModeFromText(e.mode);
    const key = `challenge-${e.id}`;
    if (matches.some((m) => m.key === key)) continue;

    const status =
      e.status === "upcoming"
        ? "upcoming"
        : e.status === "cancel"
          ? "cancel"
          : e.status === "done" || e.status === "win" || e.status === "lose"
            ? e.status
            : new Date(e.scheduledAt) < new Date()
              ? "done"
              : "upcoming";

    const stackName =
      (e.stack && String(e.stack).trim()) ||
      (tagUp === "BB" ? "Main" : clan.tag);
    const stackLogo =
      tagUp === "BB"
        ? stackName.toLowerCase().includes("jun")
          ? clanLogoUrl("BB-JUNIOR")
          : clanLogoUrl("BB-MAIN")
        : ourLogo;

    matches.push(
      enrichPreview(
        {
          key,
          day,
          month,
          year,
          timeMsk: `${hh}:${mm}`,
          opp: e.opponentTag || e.opponentName || "?",
          map: modeLabel(modeId),
          mapShort: modeLabel(modeId),
          size: e.format > 0 ? String(e.format) : "—",
          stack: stackName,
          server: e.assignedServer || "—",
          rules: "—",
          note: null,
          status,
          meeting: null,
          forecast: EMPTY_FORECAST,
        },
        stackLogo || ourLogo,
        "challenge"
      )
    );
  }

  matches.sort((a, b) => {
    const ta = a.year * 1000000 + a.month * 10000 + a.day * 100;
    const tb = b.year * 1000000 + b.month * 10000 + b.day * 100;
    if (ta !== tb) return ta - tb;
    return String(a.timeMsk).localeCompare(String(b.timeMsk));
  });

  return NextResponse.json({
    ok: true,
    clan: {
      id: clan.id,
      tag: clan.tag,
      name: clan.name,
      logoUrl: ourLogo,
    },
    matches,
  });
}
