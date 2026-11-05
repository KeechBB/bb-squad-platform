import { mkdir, writeFile, unlink, readdir } from "fs/promises";
import path from "path";
import sharp from "sharp";
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

/** Белый / почти белый / шахматный серый фон → прозрачность, всегда PNG. */
export async function stripLogoWhiteBackground(buf: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(buf)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const out = Buffer.from(data);
  for (let i = 0; i < out.length; i += 4) {
    const r = out[i];
    const g = out[i + 1];
    const b = out[i + 2];
    const chroma = Math.max(Math.abs(r - g), Math.abs(g - b), Math.abs(r - b));
    // нейтральный светлый фон (белый JPG + flattened checkerboard ~225/255)
    if (chroma <= 12 && r >= 200 && g >= 200 && b >= 200) {
      out[i + 3] = 0;
      continue;
    }
    if (r >= 235 && g >= 235 && b >= 235) {
      out[i + 3] = 0;
    } else if (r >= 220 && g >= 220 && b >= 220) {
      const whiteness = (r + g + b) / 3 / 255;
      out[i + 3] = Math.max(0, Math.min(255, Math.round((1 - whiteness) * 255 * 4)));
    }
  }
  return sharp(out, {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .png()
    .toBuffer();
}

export async function saveFactionLogo(id: string, buf: Buffer, _mime: ClanLogoMime) {
  await mkdir(FACTION_LOGO_DIR, { recursive: true });
  await clear(id);
  const png = await stripLogoWhiteBackground(buf);
  await writeFile(path.join(FACTION_LOGO_DIR, `${id}.png`), png);
  return `/api/factions/logo/${id}.png?v=${Date.now()}`;
}
