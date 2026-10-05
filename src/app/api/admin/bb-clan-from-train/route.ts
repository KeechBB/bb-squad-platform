import { NextResponse } from "next/server";
import { requireKeechOnly } from "@/lib/requireAdmin";
import { addTrainPlayersToBlackberryClan } from "@/lib/bbClanFromTrain";
import { syncBbSquadsFromKv } from "@/lib/bbStackAuto";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Keech only: разово добавить всех с TR1 / train RP в ClanMember BlackBerry. */
export async function POST() {
  const gate = await requireKeechOnly();
  if (gate.error) return gate.error;

  try {
    const result = await addTrainPlayersToBlackberryClan();
    let stacks: Awaited<ReturnType<typeof syncBbSquadsFromKv>> | null = null;
    try {
      stacks = await syncBbSquadsFromKv();
    } catch (e) {
      console.error("[bb-clan-from-train] stack sync", e);
    }
    return NextResponse.json({
      ...result,
      stacks: stacks
        ? {
            ok: stacks.ok,
            main: stacks.main.length,
            junior: stacks.junior.length,
            message: stacks.message,
          }
        : null,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[bb-clan-from-train]", msg);
    return NextResponse.json(
      { ok: false, error: "sync_failed", detail: msg.slice(0, 400) },
      { status: 500 }
    );
  }
}
