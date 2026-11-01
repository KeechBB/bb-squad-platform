import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  homeCwAnnounces,
  readyNicks,
  viewerGoing,
  viewerIsBlackberry,
  type CwAnnounce,
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
  const slots = await homeCwAnnounces();
  async function pack(slot: CwAnnounce) {
    const [ready, going] = await Promise.all([
      readyNicks(slot.id),
      viewerGoing(slot.id, userId),
    ]);
    return { ...slot, ready, going };
  }
  const cards = await Promise.all(slots.map(pack));
  return NextResponse.json(
    { cards },
    { headers: { "Cache-Control": "no-store" } }
  );
}
