import { mkdir, unlink, writeFile } from "fs/promises";
import path from "path";

export const NET_DIR = path.join(process.cwd(), "storage", "net");
export const NET_MAX_BYTES = 50 * 1024 * 1024;

export type NetMime =
  | "image/jpeg"
  | "image/png"
  | "image/webp"
  | "image/gif"
  | "video/mp4"
  | "video/webm";

const EXT: Record<NetMime, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/webm": "webm",
};

export function detectNetMime(buf: Buffer): NetMime | null {
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
  if (buf.length >= 6 && (buf.toString("ascii", 0, 6) === "GIF87a" || buf.toString("ascii", 0, 6) === "GIF89a")) {
    return "image/gif";
  }
  if (buf.length >= 12 && buf.toString("ascii", 4, 8) === "ftyp") {
    return "video/mp4";
  }
  if (buf.length >= 4 && buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) {
    return "video/webm";
  }
  return null;
}

export function isStillImage(mime: NetMime): boolean {
  return mime === "image/jpeg" || mime === "image/png" || mime === "image/webp";
}

export function isSafeNetFile(name: string): boolean {
  return /^[a-z0-9_-]+\.(jpg|png|webp|gif|mp4|webm)$/i.test(name);
}

export function netMediaUrl(file: string): string {
  return `/api/net/media/${file}`;
}

export async function saveNetFile(file: string, buf: Buffer): Promise<string> {
  if (!isSafeNetFile(file)) throw new Error("bad file");
  await mkdir(NET_DIR, { recursive: true });
  await writeFile(path.join(NET_DIR, file), buf);
  return netMediaUrl(file);
}

export async function removeNetFile(url: string | null | undefined) {
  if (!url) return;
  const name = url.split("/").pop()?.split("?")[0] || "";
  if (!isSafeNetFile(name)) return;
  await unlink(path.join(NET_DIR, name)).catch(() => undefined);
}

export function extOf(mime: NetMime): string {
  return EXT[mime];
}
