import { mkdir, readdir, readFile, unlink, writeFile } from "fs/promises";
import path from "path";

export { resolveAvatarSrc, withAvatarCacheBust } from "@/lib/avatarUrl";

export const AVATAR_DIR = path.join(process.cwd(), "storage", "avatars");
export const AVATAR_DIR_LEGACY = path.join(
  process.cwd(),
  "public",
  "uploads",
  "avatars"
);
export const AVATAR_MAX_BYTES = 20 * 1024 * 1024;

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

export function isSafeAvatarFilename(name: string): boolean {
  return /^[a-z0-9_-]+\.(jpg|jpeg|png|webp)$/i.test(name);
}

export function publicAvatarPath(userId: string, ext: string, bust?: number) {
  const q = bust ? `?v=${bust}` : "";
  return `/api/avatars/${userId}.${ext}${q}`;
}

export async function ensureAvatarDir() {
  await mkdir(AVATAR_DIR, { recursive: true });
}

async function clearDirForUser(dir: string, userId: string) {
  try {
    const files = await readdir(dir);
    await Promise.all(
      files
        .filter((f) => f.startsWith(`${userId}.`))
        .map((f) => unlink(path.join(dir, f)).catch(() => undefined))
    );
  } catch {
    /* dir may not exist */
  }
}

export async function removeUserAvatarFiles(userId: string) {
  await ensureAvatarDir();
  await clearDirForUser(AVATAR_DIR, userId);
  await clearDirForUser(AVATAR_DIR_LEGACY, userId);
}

export async function saveUserAvatar(userId: string, buf: Buffer, mime: AvatarMime) {
  await ensureAvatarDir();
  await removeUserAvatarFiles(userId);
  const ext = AVATAR_TYPES[mime];
  const fileName = `${userId}.${ext}`;
  const filePath = path.join(AVATAR_DIR, fileName);
  await writeFile(filePath, buf);
  const check = await readAvatarFile(fileName);
  if (!check) {
    throw new Error("Файл записан, но сервер его не видит (проверь storage/avatars)");
  }
  return publicAvatarPath(userId, ext, Date.now());
}

export async function readAvatarFile(filename: string): Promise<{
  buf: Buffer;
  contentType: string;
} | null> {
  if (!isSafeAvatarFilename(filename)) return null;
  const candidates = [
    path.join(AVATAR_DIR, filename),
    path.join(AVATAR_DIR_LEGACY, filename),
  ];
  for (const filePath of candidates) {
    try {
      const buf = await readFile(filePath);
      const ext = path.extname(filename).slice(1).toLowerCase();
      const contentType =
        ext === "png"
          ? "image/png"
          : ext === "webp"
            ? "image/webp"
            : "image/jpeg";
      return { buf, contentType };
    } catch {
      /* try next */
    }
  }
  return null;
}
