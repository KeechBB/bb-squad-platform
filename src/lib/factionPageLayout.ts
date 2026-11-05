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

const DIR = path.join(process.cwd(), "data", "faction-layouts");
const LEGACY = path.join(process.cwd(), "data", "faction-page-layout.json");

function layoutPath(factionId: string) {
  return path.join(DIR, `${factionId}.json`);
}

async function readRaw(file: string): Promise<FactionPageLayout | null> {
  try {
    const raw = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(raw) as Partial<FactionPageLayout>;
    const base = defaultFactionPageLayout();
    for (const id of FACTION_PANE_IDS) {
      const src = parsed.panes?.[id];
      if (src) base.panes[id] = clampFactionPane(src, DEFAULT_FACTION_PANES[id]);
    }
    base.updatedAt = typeof parsed.updatedAt === "string" ? parsed.updatedAt : null;
    return base;
  } catch {
    return null;
  }
}

export async function readFactionPageLayout(factionId: string): Promise<FactionPageLayout> {
  const own = await readRaw(layoutPath(factionId));
  if (own) return own;
  const legacy = await readRaw(LEGACY);
  if (legacy) return legacy;
  return defaultFactionPageLayout();
}

export async function writeFactionPageLayout(
  factionId: string,
  layout: FactionPageLayout
): Promise<void> {
  const next = defaultFactionPageLayout();
  next.updatedAt = new Date().toISOString();
  for (const id of FACTION_PANE_IDS) {
    next.panes[id] = clampFactionPane(layout.panes[id], DEFAULT_FACTION_PANES[id]);
  }
  await fs.mkdir(DIR, { recursive: true });
  await fs.writeFile(layoutPath(factionId), `${JSON.stringify(next, null, 2)}\n`, "utf8");
}
