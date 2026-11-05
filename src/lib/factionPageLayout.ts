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

function safeId(id: string) {
  const clean = id.replace(/[^a-zA-Z0-9_-]/g, "");
  return clean.length > 0 && clean === id ? clean : "";
}

function layoutPath(factionId: string) {
  return path.join(DIR, `${factionId}.json`);
}

function userLayoutPath(factionId: string, userId: string) {
  return path.join(DIR, "user", `${factionId}__${userId}.json`);
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

/** Своя раскладка главы, зама или Keech. Остальные её не видят. */
export async function readUserFactionPageLayout(
  factionId: string,
  userId: string,
  opts?: { keech?: boolean }
): Promise<FactionPageLayout> {
  const fid = safeId(factionId);
  const uid = safeId(userId);
  if (fid && uid) {
    const personal = await readRaw(userLayoutPath(fid, uid));
    if (personal) return personal;
  }
  if (opts?.keech) return readFactionPageLayout(factionId);
  return defaultFactionPageLayout();
}

export async function writeUserFactionPageLayout(
  factionId: string,
  userId: string,
  layout: FactionPageLayout
): Promise<void> {
  const fid = safeId(factionId);
  const uid = safeId(userId);
  if (!fid || !uid) return;
  const next = defaultFactionPageLayout();
  next.updatedAt = new Date().toISOString();
  for (const id of FACTION_PANE_IDS) {
    next.panes[id] = clampFactionPane(layout.panes[id], DEFAULT_FACTION_PANES[id]);
  }
  const file = userLayoutPath(fid, uid);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(next, null, 2)}\n`, "utf8");
}
