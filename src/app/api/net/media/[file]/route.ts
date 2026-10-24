import { readFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import { isSafeNetFile, NET_DIR } from "@/lib/netMedia";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MIME: Record<string, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  mp4: "video/mp4",
  webm: "video/webm",
};

export async function GET(_req: Request, ctx: { params: Promise<{ file: string }> }) {
  const { file } = await ctx.params;
  if (!isSafeNetFile(file)) {
    return NextResponse.json({ error: "Нет файла" }, { status: 404 });
  }
  try {
    const buf = await readFile(path.join(NET_DIR, file));
    const ext = file.split(".").pop()?.toLowerCase() || "";
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": MIME[ext] || "application/octet-stream",
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return NextResponse.json({ error: "Нет файла" }, { status: 404 });
  }
}
