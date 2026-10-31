import { randomBytes } from "crypto";
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";

export const MAIL_IMAGE_DIR = path.join(process.cwd(), "storage", "mail-images");
export const MAIL_IMAGE_MAX = 8 * 1024 * 1024;

const EXT = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
} as const;

export type MailImageMime = keyof typeof EXT;

export function detectMailImageMime(buf: Buffer): MailImageMime | null {
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
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "image/jpeg";
  }
  if (buf.length >= 6) {
    const head = buf.toString("ascii", 0, 6);
    if (head === "GIF87a" || head === "GIF89a") return "image/gif";
  }
  return null;
}

export async function saveMailImage(buf: Buffer, mime: MailImageMime) {
  await mkdir(MAIL_IMAGE_DIR, { recursive: true });
  const name = `${randomBytes(12).toString("hex")}.${EXT[mime]}`;
  await writeFile(path.join(MAIL_IMAGE_DIR, name), buf);
  return `/api/mail/image/${name}`;
}

const TYPE_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

export async function readMailImage(file: string) {
  if (!/^[a-f0-9]{24}\.(png|jpg|webp|gif)$/i.test(file)) return null;
  const dir = path.resolve(MAIL_IMAGE_DIR);
  const full = path.resolve(dir, file);
  if (!full.startsWith(dir + path.sep)) return null;
  try {
    const buf = await readFile(full);
    const ext = file.split(".").pop()?.toLowerCase() || "";
    const contentType = TYPE_BY_EXT[ext];
    if (!contentType) return null;
    return { buf, contentType };
  } catch {
    return null;
  }
}
