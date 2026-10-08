import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { modeLabel } from "@/lib/cwChallenge";
import { buildCalendarMatches } from "@/lib/kvForecast";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.steamId || !session.user.profileComplete) {
    return NextResponse.json({ error: "Нужен вход" }, { status: 401 });
  }

  const { id: clanId } = await ctx.params;
  const clan = await prisma.clan.findUnique({
    where: { id: clanId },
    select: { id: true, tag: true, name: true },
  });
  if (!clan) {
    return NextResponse.json({ error: "Клан не найден" }, { status: 404 });
  }

  const events = await prisma.clanCalendarEvent.findMany({
    where: { clanId },
    orderBy: { scheduledAt: "asc" },
    take: 200,
  });

  const mapped = events.map((e) => ({
    id: e.id,
    mode: e.mode,
    modeLabel: modeLabel(e.mode),
    format: e.format,
    scheduledAt: e.scheduledAt.toISOString(),
    opponentTag: e.opponentTag,
    opponentName: e.opponentName,
    assignedServer: e.assignedServer,
    status: e.status,
    challengeId: e.challengeId,
    source: "challenge" as const,
  }));

  // BlackBerry: плюс слоты из KV-календаря (раньше были на главной)
  if (clan.tag.toUpperCase() === "BB") {
    try {
      const { previews } = await buildCalendarMatches();
      for (const p of previews) {
        const y = p.year;
        const mo = p.month;
        const d = p.day;
        const [hh, mm] = String(p.timeMsk || "00:00").split(":").map(Number);
        const scheduledAt = new Date(
          Date.UTC(y, mo - 1, d, (hh || 0) - 3, mm || 0, 0)
        );
        mapped.push({
          id: `kv-${p.key}`,
          mode: "HOTDROP",
          modeLabel: p.map || "КВ",
          format: 0,
          scheduledAt: scheduledAt.toISOString(),
          opponentTag: p.opp || "?",
          opponentName: p.opp || "?",
          assignedServer: p.server || null,
          status:
            p.status === "upcoming"
              ? "upcoming"
              : p.status === "cancel"
                ? "cancel"
                : "done",
          challengeId: null,
          source: "kv" as const,
        });
      }
    } catch {
      /* KV optional */
    }
  }

  mapped.sort(
    (a, b) =>
      new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime()
  );

  return NextResponse.json({
    ok: true,
    clan,
    events: mapped,
  });
}
