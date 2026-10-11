/**
 * Write nick aliases into local KV tiers.json so train/CW stats follow a rename.
 * SERVER ONLY.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { clearKvMemCache, kvLocalRoots } from "@/lib/kvLocal";
import { nickKey } from "@/lib/nickIdentity";

type TiersFile = {
  aliases?: Record<string, string>;
  [k: string]: unknown;
};

function tiersPaths(): string[] {
  const out: string[] = [];
  for (const root of kvLocalRoots()) {
    out.push(path.join(root, "data", "tiers.json"));
  }
  const bb =
    process.env.BB_KV_PUBLIC?.trim() ||
    process.env.KV_PUBLIC?.trim() ||
    "";
  if (bb) {
    out.push(path.join(bb, "data", "tiers.json"));
  }
  // de-dupe
  return [...new Set(out.map((p) => path.resolve(p)))];
}

/** Point old nick (and any aliases that pointed to it) at the new canon nick. */
export async function recordNickRenameAlias(
  oldNick: string,
  newNick: string
): Promise<{ ok: boolean; written: string[]; error?: string }> {
  const from = String(oldNick || "").trim();
  const to = String(newNick || "").trim();
  if (!from || !to) return { ok: false, written: [], error: "empty nick" };
  if (nickKey(from) === nickKey(to)) {
    return { ok: true, written: [] };
  }

  const written: string[] = [];
  let lastErr = "";

  for (const file of tiersPaths()) {
    try {
      const raw = await fs.readFile(file, "utf8");
      const data = JSON.parse(raw) as TiersFile;
      const aliases = { ...(data.aliases || {}) };

      // Remap anything that pointed at old canon → new
      for (const [k, v] of Object.entries(aliases)) {
        if (nickKey(String(v)) === nickKey(from)) {
          aliases[k] = to;
        }
      }
      aliases[nickKey(from)] = to;
      // Also keep display-case key if different
      if (from !== nickKey(from)) {
        aliases[from] = to;
      }

      data.aliases = aliases;
      await fs.writeFile(
        file,
        JSON.stringify(data, null, 2) + "\n",
        "utf8"
      );
      written.push(file);
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
    }
  }

  clearKvMemCache();
  if (!written.length) {
    return {
      ok: false,
      written,
      error: lastErr || "tiers.json not writable",
    };
  }
  return { ok: true, written };
}
