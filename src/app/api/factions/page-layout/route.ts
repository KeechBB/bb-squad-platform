import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { isBuiltinSuperAdmin } from "@/lib/admin";
import {
  FACTION_PANE_IDS,
  readFactionPageLayout,
  writeFactionPageLayout,
  type FactionPageLayout,
} from "@/lib/factionPageLayout";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await readFactionPageLayout());
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!isBuiltinSuperAdmin(session?.user?.steamId)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let body: Partial<FactionPageLayout>;
  try {
    body = (await req.json()) as Partial<FactionPageLayout>;
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }

  const current = await readFactionPageLayout();
  const next: FactionPageLayout = {
    updatedAt: null,
    panes: { ...current.panes },
  };
  for (const id of FACTION_PANE_IDS) {
    const box = body.panes?.[id];
    if (box) next.panes[id] = box;
  }
  await writeFactionPageLayout(next);
  return NextResponse.json(await readFactionPageLayout());
}
