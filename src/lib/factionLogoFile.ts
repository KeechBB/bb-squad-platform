import { mkdir, writeFile, unlink, readdir } from "fs/promises";
import path from "path";
import type { ClanLogoMime } from "@/lib/clanLogoFile";

export const FACTION_LOGO_DIR = path.join(process.cwd(), "storage", "factions");

const TYPES: Record<ClanLogoMime, string> = {
  "image/png": "png",
  "image/webp": "webp",
  "image/jpeg": "jpg",
};

async function clear(id: string) {
  try {
    const files = await readdir(FACTION_LOGO_DIR);
    await Promise.all(
      files
        .filter((f) => f.startsWith(`${id}.`))
        .map((f) => unlink(path.join(FACTION_LOGO_DIR, f)).catch(() => undefined))
    );
  } catch {
    /* empty dir */
  }
}

export async function removeFactionLogo(id: string) {
  await clear(id);
}

export async function saveFactionLogo(id: string, buf: Buffer, mime: ClanLogoMime) {
  await mkdir(FACTION_LOGO_DIR, { recursive: true });
  await clear(id);
  const ext = TYPES[mime];
  await writeFile(path.join(FACTION_LOGO_DIR, `${id}.${ext}`), buf);
  return `/api/factions/logo/${id}.${ext}?v=${Date.now()}`;
}
