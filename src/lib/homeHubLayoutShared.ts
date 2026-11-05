/** Client-safe hub layout types/constants (no fs). */

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

export const DEFAULT_HUB_TILES: Record<string, HubTileBox> = {
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
export const DEFAULT_HUB_PREVIEWS: Record<HubPreviewId, HubTileBox> = {
  junior: { left: 1.15, top: 1.8, width: 11.15, height: 29.5 },
  main: { left: 1.15, top: 32.2, width: 11.15, height: 29.5 },
  clan: { left: 1.15, top: 62.6, width: 11.15, height: 29.5 },
};
