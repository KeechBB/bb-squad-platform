import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";
import { FACTION_LOGO_DIR } from "@/lib/factionLogoFile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ file: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { file } = await ctx.params;
  if (!/^[a-z0-9]+\.(png|webp|jpe?g)$/i.test(file)) {
    return new NextResponse("Not found", { status: 404 });
  }
  try {
    const buf = await readFile(path.join(FACTION_LOGO_DIR, file));
    const ext = path.extname(file).slice(1).toLowerCase();
    const type =
      ext === "webp"
        ? "image/webp"
        : ext === "jpg" || ext === "jpeg"
          ? "image/jpeg"
          : "image/png";
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": type,
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
}
