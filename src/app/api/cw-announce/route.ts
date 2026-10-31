import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  nextCwAnnounces,
  readyNicks,
  viewerGoing,
  viewerIsBlackberry,
} from "@/lib/cwReady";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Актуальные карточки КВ для главной (после переносов в календаре). */
export async function GET() {
  const session = await getSession();
  const userId = session?.user?.id || "";
  if (!(await viewerIsBlackberry(userId))) {
    return NextResponse.json({ main: null, junior: null });
  }
  const next = await nextCwAnnounces();
  async function pack(
    slot: Awaited<ReturnType<typeof nextCwAnnounces>>["main"]
  ) {
    if (!slot) return null;
    const [ready, going] = await Promise.all([
      readyNicks(slot.id),
      viewerGoing(slot.id, userId),
    ]);
    return { ...slot, ready, going };
  }
  const [main, junior] = await Promise.all([
    pack(next.main),
    pack(next.junior),
  ]);
  return NextResponse.json(
    { main, junior },
    { headers: { "Cache-Control": "no-store" } }
  );
}
