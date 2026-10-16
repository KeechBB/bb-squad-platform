import { NextResponse } from "next/server";
import { buildUpcomingMatchPreviews } from "@/lib/kvForecast";
import { memoTtl } from "@/lib/memoTtl";

export const dynamic = "force-dynamic";

/** Сегодняшняя дата МСК как YYYYMMDD для отсечения прошедших слотов. */
function todayMskStamp(): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const y = Number(parts.find((p) => p.type === "year")?.value || 0);
  const m = Number(parts.find((p) => p.type === "month")?.value || 0);
  const d = Number(parts.find((p) => p.type === "day")?.value || 0);
  return y * 10000 + m * 100 + d;
}

function previewStamp(p: { year: number; month: number; day: number }): number {
  return p.year * 10000 + p.month * 100 + (Number(p.day) || 0);
}

async function loadPulse() {
  const today = todayMskStamp();
  const { previews } = await buildUpcomingMatchPreviews(24);
  const upcoming = previews.filter((m) => previewStamp(m) >= today);
  // На главной BB — ближайший наш КВ (bbHost), не чужие слоты календаря (NKLV vs …)
  const ours = upcoming.filter((m) => m.bbHost);
  const nextMatch = ours[0] || null;
  return {
    nextMatch,
    upcoming: ours.slice(0, 2),
    updatedAt: new Date().toISOString(),
  };
}

export async function GET() {
  try {
    const data = await memoTtl("home-pulse-v3-bb-host", 60_000, loadPulse);
    return NextResponse.json(data, {
      headers: {
        "Cache-Control":
          "public, max-age=20, s-maxage=45, stale-while-revalidate=60",
      },
    });
  } catch (e) {
    return NextResponse.json(
      {
        nextMatch: null,
        upcoming: [],
        updatedAt: new Date().toISOString(),
        error: String((e as Error)?.message || e),
      },
      { status: 200 }
    );
  }
}
