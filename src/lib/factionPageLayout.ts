import { promises as fs } from "fs";
import path from "path";
import {
  DEFAULT_FACTION_PANES,
  FACTION_PANE_IDS,
  clampFactionPane,
  defaultFactionPageLayout,
  type FactionPageLayout,
  type FactionPaneBox,
  type FactionPaneId,
} from "@/lib/factionPageLayoutShared";

export type { FactionPageLayout, FactionPaneBox, FactionPaneId } from "@/lib/factionPageLayoutShared";
export { FACTION_PANE_IDS, defaultFactionPageLayout } from "@/lib/factionPageLayoutShared";

const LAYOUT_PATH = path.join(process.cwd(), "data", "faction-page-layout.json");

export async function readFactionPageLayout(): Promise<FactionPageLayout> {
  try {
    const raw = await fs.readFile(LAYOUT_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<FactionPageLayout>;
    const base = defaultFactionPageLayout();
    for (const id of FACTION_PANE_IDS) {
      const src = parsed.panes?.[id];
      if (src) base.panes[id] = clampFactionPane(src, DEFAULT_FACTION_PANES[id]);
    }
    base.updatedAt = typeof parsed.updatedAt === "string" ? parsed.updatedAt : null;
    return base;
  } catch {
    return defaultFactionPageLayout();
  }
}

export async function writeFactionPageLayout(layout: FactionPageLayout): Promise<void> {
  const next = defaultFactionPageLayout();
  next.updatedAt = new Date().toISOString();
  for (const id of FACTION_PANE_IDS) {
    next.panes[id] = clampFactionPane(layout.panes[id], DEFAULT_FACTION_PANES[id]);
  }
  await fs.mkdir(path.dirname(LAYOUT_PATH), { recursive: true });
  await fs.writeFile(LAYOUT_PATH, `${JSON.stringify(next, null, 2)}\n`, "utf8");
}
