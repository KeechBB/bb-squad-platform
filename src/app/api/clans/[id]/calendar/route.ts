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
import { canonOpp, clanLogoUrl, kvOppMatchesClan } from "@/lib/clanLogo";

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
  const clanCanon = canonOpp(clan.name || clan.tag);
  // Для BB всегда файлы из /rating-logos (DB logoUrl часто битый upload)
  const ourLogo =
    tagUp === "BB"
      ? clanLogoUrl("BB-MAIN")
      : clanLogoUrl(tagUp) ||
        clanLogoUrl(clanCanon.key) ||
        clan.logoUrl ||
        null;

  const matches: ClanCalMatch[] = [];

  // BB: только наши слоты. Чужой: host (clan=tag) без invert, или opp=tag с invert.
  try {
    const { previews } = await buildCalendarMatches();
    if (tagUp === "BB") {
      for (const p of previews) {
        if (!p.bbHost) continue;
        const stack = String(p.stack || "").toLowerCase();
        const stackLogo = stack.includes("jun")
          ? clanLogoUrl("BB-JUNIOR")
          : clanLogoUrl("BB-MAIN");
        matches.push(enrichPreview(p, stackLogo, "kv"));
      }
    } else {
      const invertStatus = (s?: string) =>
        s === "win" ? "lose" : s === "lose" ? "win" : s || "";
      const invertMeeting = (m?: string | null) => {
        const hit = String(m || "").trim().match(/^(\d+)\s*[–\-—:]\s*(\d+)/);
        return hit ? `${hit[2]}–${hit[1]}` : m || null;
      };
      const bbStack = (stack?: string | null) => {
        const s = String(stack || "").trim().toLowerCase();
        if (s === "main") return "BB Main";
        if (s === "junior") return "BB Junior";
        return s ? `BB ${stack}` : "BB";
      };
      for (const p of previews) {
        const asHost = !p.bbHost && kvOppMatchesClan(p.clan, clan);
        const asOpp = kvOppMatchesClan(p.opp, clan);
        if (!asHost && !asOpp) continue;
        // Left side = viewing clan. Never put opp crest into ourLogo.
        const sideLogo =
          ourLogo ||
          clanLogoUrl(clan.tag) ||
          (!p.bbHost ? clanLogoUrl(p.clan) : null);
        if (asHost) {
          matches.push(
            enrichPreview(
              {
                ...p,
                stack: clan.tag,
                forecast: EMPTY_FORECAST,
              },
              sideLogo,
              "kv"
            )
          );
          continue;
        }
        matches.push(
          enrichPreview(
            {
              ...p,
              opp: p.bbHost ? bbStack(p.stack) : p.clan,
              stack: clan.tag,
              status: invertStatus(p.status),
              meeting: invertMeeting(p.meeting),
              forecast: EMPTY_FORECAST,
            },
            sideLogo,
            "kv"
          )
        );
      }
    }
  } catch {
    /* KV optional */
  }

  const events = await prisma.clanCalendarEvent.findMany({
    where: { clanId },
    orderBy: { scheduledAt: "asc" },
    take: 200,
  });

  function timeMskMinutes(t: string): number {
    const m = String(t || "").trim().match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return -1;
    return Number(m[1]) * 60 + Number(m[2]);
  }

  function stackKind(stack: string): "junior" | "main" | "other" {
    const s = String(stack || "").toLowerCase();
    if (s.includes("jun")) return "junior";
    if (s.includes("main")) return "main";
    return "other";
  }

  /** Один клан для дедупа: BB / BB Main / BB Junior — не два матча. */
  function sameClanSide(a: string, b: string): boolean {
    const ca = canonOpp(a);
    const cb = canonOpp(b);
    if (ca.key === cb.key) return true;
    if (ca.tag === "BB" && cb.tag === "BB") return true;
    return false;
  }

  /** KV-слот уже есть (заявка принята в календарь) — не дублировать challenge. */
  function coveredByKv(opts: {
    year: number;
    month: number;
    day: number;
    timeMsk: string;
    oppRaw: string;
    stack: string;
  }): boolean {
    const sk = stackKind(opts.stack);
    const mins = timeMskMinutes(opts.timeMsk);
    return matches.some((m) => {
      if (m.source !== "kv") return false;
      if (m.year !== opts.year || m.month !== opts.month || m.day !== opts.day) {
        return false;
      }
      if (!sameClanSide(m.opp, opts.oppRaw)) return false;
      if (sk !== "other" && stackKind(m.stack) !== "other" && stackKind(m.stack) !== sk) {
        return false;
      }
      const mm = timeMskMinutes(m.timeMsk);
      if (mins >= 0 && mm >= 0 && Math.abs(mins - mm) > 90) return false;
      return true;
    });
  }

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
    const oppRaw = e.opponentTag || e.opponentName || "?";
    // Принятая заявка уже лежит в KV (карта/сервер) — второй чип «Hotdrop» без карты не нужен.
    if (
      coveredByKv({
        year,
        month,
        day,
        timeMsk: `${hh}:${mm}`,
        oppRaw,
        stack: stackName,
      })
    ) {
      continue;
    }

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
          clan: tagUp === "BB" ? "BlackBerry" : clan.tag,
          opp: oppRaw,
          map: modeLabel(modeId),
          mapShort: modeLabel(modeId),
          size: e.format > 0 ? String(e.format) : "—",
          stack: stackName,
          server: e.assignedServer || "—",
          rules: "—",
          note: null,
          status,
          meeting: null,
          bbHost: tagUp === "BB",
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
