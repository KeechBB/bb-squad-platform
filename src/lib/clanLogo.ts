import { mkdir, writeFile, unlink, readdir } from "fs/promises";
import path from "path";

export const CLAN_LOGO_DIR = path.join(process.cwd(), "storage", "clans");
export const CLAN_LOGO_MAX = 5 * 1024 * 1024;

const TYPES = {
  "image/png": "png",
  "image/webp": "webp",
} as const;

export type ClanLogoMime = keyof typeof TYPES;

export function detectClanLogoMime(buf: Buffer): ClanLogoMime | null {
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  ) {
    return "image/png";
  }
  if (
    buf.length >= 12 &&
    buf.toString("ascii", 0, 4) === "RIFF" &&
    buf.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

export async function saveClanLogo(clanId: string, buf: Buffer, mime: ClanLogoMime) {
  await mkdir(CLAN_LOGO_DIR, { recursive: true });
  try {
    const files = await readdir(CLAN_LOGO_DIR);
    await Promise.all(
      files
        .filter((f) => f.startsWith(`${clanId}.`))
        .map((f) => unlink(path.join(CLAN_LOGO_DIR, f)).catch(() => undefined))
    );
  } catch {
    /* empty */
  }
  const ext = TYPES[mime];
  const filePath = path.join(CLAN_LOGO_DIR, `${clanId}.${ext}`);
  await writeFile(filePath, buf);
  return `/api/clans/logo/${clanId}.${ext}?v=${Date.now()}`;
}
