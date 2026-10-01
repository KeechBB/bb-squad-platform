import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/requireAdmin";
import { getSiteReleases } from "@/lib/siteReleases";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Список релизов для админки «Логи обновлений». */
export async function GET() {
  const gate = await requireAdmin();
  if (gate.error) return gate.error;
  const data = getSiteReleases();
  return NextResponse.json({
    ok: true,
    current: data.current,
    label: `Beta v${data.current}`,
    releases: data.releases,
  });
}
