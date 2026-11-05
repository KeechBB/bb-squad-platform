import { promises as fs } from "fs";
import path from "path";
import { HOME_HUB_TILES } from "@/lib/homeHub";

export type HubTileBox = {
  left: number;
  top: number;
  width: number;
  height: number;
};

/** Fixed preview slots on hub (КВ Junior / Main / весь клан). */
export const HOME_HUB_PREVIEW_IDS = ["junior", "main", "clan"] as const;
export type HubPreviewId = (typeof HOME_HUB_PREVIEW_IDS)[number];

export type HubTileLayout = {
  locked: boolean;
  updatedAt: string | null;
  tiles: Record<string, HubTileBox>;
  previews: Record<string, HubTileBox>;
};

const LAYOUT_PATH = path.join(process.cwd(), "data", "home-hub-tile-layout.json");

const DEFAULT_TILES: Record<string, HubTileBox> = {
  tournaments: { left: 36.2, top: 17.2, width: 9.4, height: 17.0 },
  public: { left: 45.8, top: 16.8, width: 9.4, height: 17.0 },
  cw: { left: 55.4, top: 17.2, width: 9.4, height: 17.0 },
  training: { left: 36.0, top: 38.2, width: 9.4, height: 17.0 },
  "battle-pass": { left: 45.8, top: 38.0, width: 9.4, height: 17.0 },
  marketplace: { left: 55.6, top: 38.2, width: 9.4, height: 17.0 },
  "my-clan": { left: 36.2, top: 59.0, width: 9.4, height: 17.0 },
  "my-team": { left: 45.8, top: 59.0, width: 9.4, height: 17.0 },
  "my-faction": { left: 55.4, top: 59.0, width: 9.4, height: 17.0 },
};

/** ~214px × card stack on 1920×1004 canvas */
const DEFAULT_PREVIEWS: Record<HubPreviewId, HubTileBox> = {
  junior: { left: 1.15, top: 1.8, width: 11.15, height: 29.5 },
  main: { left: 1.15, top: 32.2, width: 11.15, height: 29.5 },
  clan: { left: 1.15, top: 62.6, width: 11.15, height: 29.5 },
};

export function defaultHubTileLayout(): HubTileLayout {
  return {
    locked: false,
    updatedAt: null,
    tiles: { ...DEFAULT_TILES },
    previews: { ...DEFAULT_PREVIEWS },
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
    const box = layout.tiles[tile.id] ?? DEFAULT_TILES[tile.id];
    next.tiles[tile.id] = clampBox(box);
  }
  for (const id of HOME_HUB_PREVIEW_IDS) {
    const box = layout.previews[id] ?? DEFAULT_PREVIEWS[id];
    next.previews[id] = clampPreviewBox(box);
  }
  await fs.mkdir(path.dirname(LAYOUT_PATH), { recursive: true });
  await fs.writeFile(LAYOUT_PATH, `${JSON.stringify(next, null, 2)}\n`, "utf8");
}
