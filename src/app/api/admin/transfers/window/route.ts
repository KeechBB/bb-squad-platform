import { NextResponse } from "next/server";
import { requireKeechOnly } from "@/lib/requireAdmin";
import { prisma } from "@/lib/prisma";
import { getTransferWindowState } from "@/lib/factionTransfers";

export const runtime = "nodejs";

export async function GET() {
  const gate = await requireKeechOnly();
  if (gate.error) return gate.error;
  const state = await getTransferWindowState();
  return NextResponse.json(state);
}

export async function PATCH(req: Request) {
  const gate = await requireKeechOnly();
  if (gate.error) return gate.error;

  const body = (await req.json().catch(() => null)) as {
    open?: boolean;
    closedFrom?: string | null;
    closedTo?: string | null;
    note?: string | null;
  } | null;

  const data: {
    open?: boolean;
    closedFrom?: Date | null;
    closedTo?: Date | null;
    note?: string | null;
    updatedBy?: string;
  } = {
    updatedBy: gate.session?.user?.steamId || null,
  };

  if (typeof body?.open === "boolean") data.open = body.open;
  if (body && "closedFrom" in body) {
    data.closedFrom = body.closedFrom ? new Date(body.closedFrom) : null;
  }
  if (body && "closedTo" in body) {
    data.closedTo = body.closedTo ? new Date(body.closedTo) : null;
  }
  if (body && "note" in body) data.note = body.note || null;

  await prisma.transferWindowSetting.upsert({
    where: { id: "global" },
    create: {
      id: "global",
      open: data.open ?? true,
      closedFrom: data.closedFrom ?? null,
      closedTo: data.closedTo ?? null,
      note: data.note ?? null,
      updatedBy: data.updatedBy ?? null,
    },
    update: data,
  });

  const state = await getTransferWindowState();
  return NextResponse.json(state);
}
