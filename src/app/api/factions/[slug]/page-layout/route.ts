import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  FACTION_PANE_IDS,
  readUserFactionPageLayout,
  writeUserFactionPageLayout,
  type FactionPageLayout,
} from "@/lib/factionPageLayout";
import { loadFactionView } from "@/lib/factions";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const session = await getSession();
  const { slug } = await ctx.params;
  const loaded = await loadFactionView(decodeURIComponent(slug), session?.user?.steamId ?? null);
  if (loaded.error || !loaded.view) {
    return NextResponse.json({ error: "Не найдено" }, { status: 404 });
  }
  if (!loaded.me?.id || (!loaded.view.keech && !loaded.view.canManage)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  return NextResponse.json(
    await readUserFactionPageLayout(loaded.view.id, loaded.me.id, { keech: loaded.view.keech })
  );
}

export async function POST(req: Request, ctx: Ctx) {
  const session = await getSession();
  const { slug } = await ctx.params;
  const loaded = await loadFactionView(decodeURIComponent(slug), session?.user?.steamId ?? null);
  if (loaded.error || !loaded.view) {
    return NextResponse.json({ error: "Не найдено" }, { status: 404 });
  }
  // Keech / глава / зам
  if (!loaded.me?.id || (!loaded.view.keech && !loaded.view.canManage)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let body: Partial<FactionPageLayout>;
  try {
    body = (await req.json()) as Partial<FactionPageLayout>;
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }

  const current = await readUserFactionPageLayout(loaded.view.id, loaded.me.id, {
    keech: loaded.view.keech,
  });
  const next: FactionPageLayout = {
    updatedAt: null,
    panes: { ...current.panes },
  };
  for (const id of FACTION_PANE_IDS) {
    const box = body.panes?.[id];
    if (box) next.panes[id] = box;
  }
  await writeUserFactionPageLayout(loaded.view.id, loaded.me.id, next);
  return NextResponse.json(
    await readUserFactionPageLayout(loaded.view.id, loaded.me.id, { keech: loaded.view.keech })
  );
}
