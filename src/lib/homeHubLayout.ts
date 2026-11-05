import { promises as fs } from "fs";
import path from "path";
import { HOME_HUB_TILES } from "@/lib/homeHub";
import {
  DEFAULT_HUB_PREVIEWS,
  DEFAULT_HUB_TILES,
  HOME_HUB_PREVIEW_IDS,
  type HubTileBox,
  type HubTileLayout,
} from "@/lib/homeHubLayoutShared";

export type {
  HubPreviewId,
  HubTileBox,
  HubTileLayout,
} from "@/lib/homeHubLayoutShared";
export { HOME_HUB_PREVIEW_IDS } from "@/lib/homeHubLayoutShared";

const LAYOUT_PATH = path.join(process.cwd(), "data", "home-hub-tile-layout.json");

export function defaultHubTileLayout(): HubTileLayout {
  return {
    locked: false,
    updatedAt: null,
    tiles: { ...DEFAULT_HUB_TILES },
    previews: { ...DEFAULT_HUB_PREVIEWS },
  };
}

function clampBox(box: HubTileBox): HubTileBox {
  const width = Math.min(28, Math.max(4, Number(box.width) || 9.4));
  const height = Math.min(40, Math.max(6, Number(box.height) || 17));
  const left = Math.min(100 - width, Math.max(0, Number(box.left) || 0));
  const top = Math.min(100 - height, Math.max(0, Number(box.top) || 0));
  return { left, top, width, height };
}

function clampPreviewBox(box: HubTileBox): HubTileBox {
  const width = Math.min(22, Math.max(6, Number(box.width) || 11.15));
  const height = Math.min(48, Math.max(10, Number(box.height) || 29.5));
  const left = Math.min(100 - width, Math.max(0, Number(box.left) || 0));
  const top = Math.min(100 - height, Math.max(0, Number(box.top) || 0));
  return { left, top, width, height };
}

export async function readHubTileLayout(): Promise<HubTileLayout> {
  try {
    const raw = await fs.readFile(LAYOUT_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<HubTileLayout>;
    const base = defaultHubTileLayout();
    const tiles: Record<string, HubTileBox> = { ...base.tiles };
    for (const tile of HOME_HUB_TILES) {
      const src = parsed.tiles?.[tile.id];
      if (src) tiles[tile.id] = clampBox(src);
    }
    const previews: Record<string, HubTileBox> = { ...base.previews };
    for (const id of HOME_HUB_PREVIEW_IDS) {
      const src = parsed.previews?.[id];
      if (src) previews[id] = clampPreviewBox(src);
    }
    return {
      locked: Boolean(parsed.locked),
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : null,
      tiles,
      previews,
    };
  } catch {
    return defaultHubTileLayout();
  }
}

export async function writeHubTileLayout(layout: HubTileLayout): Promise<void> {
  const next: HubTileLayout = {
    locked: Boolean(layout.locked),
    updatedAt: new Date().toISOString(),
    tiles: {},
    previews: {},
  };
  for (const tile of HOME_HUB_TILES) {
    const box = layout.tiles[tile.id] ?? DEFAULT_HUB_TILES[tile.id];
    next.tiles[tile.id] = clampBox(box);
  }
  for (const id of HOME_HUB_PREVIEW_IDS) {
    const box = layout.previews[id] ?? DEFAULT_HUB_PREVIEWS[id];
    next.previews[id] = clampPreviewBox(box);
  }
  await fs.mkdir(path.dirname(LAYOUT_PATH), { recursive: true });
  await fs.writeFile(LAYOUT_PATH, `${JSON.stringify(next, null, 2)}\n`, "utf8");
}
