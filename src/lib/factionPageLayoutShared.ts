/** Client-safe faction page layout. No filesystem. */

export const FACTION_PANE_IDS = ["brand", "controls", "info", "stats", "roster"] as const;
export type FactionPaneId = (typeof FACTION_PANE_IDS)[number];

export type FactionPaneBox = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type FactionPageLayout = {
  updatedAt: string | null;
  panes: Record<FactionPaneId, FactionPaneBox>;
};

/** Схема: название слева, панель и информация посередине, статистика снизу, состав справа. */
export const DEFAULT_FACTION_PANES: Record<FactionPaneId, FactionPaneBox> = {
  brand: { left: 0, top: 0, width: 36, height: 42 },
  controls: { left: 36.8, top: 0, width: 30, height: 24 },
  info: { left: 36.8, top: 24.8, width: 30, height: 17.2 },
  stats: { left: 0, top: 42.8, width: 66.8, height: 57.2 },
  roster: { left: 67.6, top: 0, width: 32.4, height: 100 },
};

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

export function clampFactionPane(
  box: Partial<FactionPaneBox> | null | undefined,
  fallback: FactionPaneBox
): FactionPaneBox {
  const width = Math.min(92, Math.max(12, Number(box?.width) || fallback.width));
  const height = Math.min(100, Math.max(8, Number(box?.height) || fallback.height));
  const left = Math.min(100 - width, Math.max(0, Number(box?.left) || 0));
  const top = Math.min(100 - height, Math.max(0, Number(box?.top) || 0));
  return { left: round2(left), top: round2(top), width: round2(width), height: round2(height) };
}

export function defaultFactionPageLayout(): FactionPageLayout {
  const panes = {} as Record<FactionPaneId, FactionPaneBox>;
  for (const id of FACTION_PANE_IDS) {
    panes[id] = { ...DEFAULT_FACTION_PANES[id] };
  }
  return { updatedAt: null, panes };
}
