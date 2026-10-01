import { NextResponse } from "next/server";
import { getCurrentBetaLabel, getSiteReleases } from "@/lib/siteReleases";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Публичная текущая Beta-версия (для бейджа и внешних виджетов). */
export async function GET() {
  const { current, releases } = getSiteReleases();
  return NextResponse.json({
    ok: true,
    current,
    label: getCurrentBetaLabel(),
    latest: releases[0] || null,
  });
}
