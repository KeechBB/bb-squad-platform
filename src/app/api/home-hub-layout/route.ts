import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { isBuiltinSuperAdmin } from "@/lib/admin";
import {
  HOME_HUB_PREVIEW_IDS,
  defaultHubTileLayout,
  readHubTileLayout,
  writeHubTileLayout,
  type HubTileBox,
  type HubTileLayout,
} from "@/lib/homeHubLayout";
import { HOME_HUB_TILES } from "@/lib/homeHub";

export const dynamic = "force-dynamic";

export async function GET() {
  const layout = await readHubTileLayout();
  return NextResponse.json(layout);
}

export async function POST(req: Request) {
  const session = await getSession();
  const steamId = session?.user?.steamId;
  if (!isBuiltinSuperAdmin(steamId)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const current = await readHubTileLayout();
  if (current.locked) {
    return NextResponse.json(
      { error: "layout_locked", message: "Раскладка уже зафиксирована" },
      { status: 409 }
    );
  }

  let body: Partial<HubTileLayout>;
  try {
    body = (await req.json()) as Partial<HubTileLayout>;
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }

  const next = defaultHubTileLayout();
  next.locked = false;
  for (const tile of HOME_HUB_TILES) {
    const box = (body.tiles?.[tile.id] ?? current.tiles[tile.id]) as HubTileBox;
    next.tiles[tile.id] = box;
  }
  for (const id of HOME_HUB_PREVIEW_IDS) {
    const box = (body.previews?.[id] ??
      current.previews[id]) as HubTileBox;
    next.previews[id] = box;
  }
  await writeHubTileLayout(next);
  const saved = await readHubTileLayout();
  return NextResponse.json(saved);
}
