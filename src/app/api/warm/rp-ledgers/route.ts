import { NextResponse } from "next/server";
import { warmPublicRpCaches } from "@/lib/publicRp";
import { warmTrainRpCaches } from "@/lib/trainRp";
import { buildPublicRatingTable } from "@/lib/publicCombat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Прогрев тяжёлых JSON в RAM воркера (cron бьёт несколько раз → все PM2 workers).
 */
export async function GET() {
  const t0 = Date.now();
  const [pub, train, table] = await Promise.all([
    warmPublicRpCaches(),
    warmTrainRpCaches(),
    buildPublicRatingTable(500)
      .then((t) => ({ rows: t.rows.length, matches: t.matches }))
      .catch(() => ({ rows: 0, matches: 0 })),
  ]);
  return NextResponse.json({
    ok: true,
    ms: Date.now() - t0,
    public: pub,
    train,
    publicRatingTable: table,
  });
}
