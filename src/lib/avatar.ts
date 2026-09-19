import { mkdir, readdir, unlink, writeFile } from "fs/promises";
import path from "path";

export const AVATAR_DIR = path.join(process.cwd(), "public", "uploads", "avatars");
export const AVATAR_MAX_BYTES = 1024 * 1024;

export const AVATAR_TYPES = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
} as const;

export type AvatarMime = keyof typeof AVATAR_TYPES;

export function detectAvatarMime(buf: Buffer): AvatarMime | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "image/jpeg";
  }
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

export function publicAvatarPath(userId: string, ext: string, bust?: number) {
  const q = bust ? `?v=${bust}` : "";
  return `/uploads/avatars/${userId}.${ext}${q}`;
}

export async function ensureAvatarDir() {
  await mkdir(AVATAR_DIR, { recursive: true });
}

export async function removeUserAvatarFiles(userId: string) {
  await ensureAvatarDir();
  const files = await readdir(AVATAR_DIR);
  await Promise.all(
    files
      .filter((f) => f.startsWith(`${userId}.`))
      .map((f) => unlink(path.join(AVATAR_DIR, f)).catch(() => undefined))
  );
}

export async function saveUserAvatar(userId: string, buf: Buffer, mime: AvatarMime) {
  await ensureAvatarDir();
  await removeUserAvatarFiles(userId);
  const ext = AVATAR_TYPES[mime];
  const filePath = path.join(AVATAR_DIR, `${userId}.${ext}`);
  await writeFile(filePath, buf);
  return publicAvatarPath(userId, ext, Date.now());
}
