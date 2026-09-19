import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";
import { CLAN_LOGO_DIR } from "@/lib/clanLogo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ file: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { file } = await ctx.params;
  if (!/^[a-z0-9_-]+\.(png|webp)$/i.test(file)) {
    return new NextResponse("Not found", { status: 404 });
  }
  try {
    const buf = await readFile(path.join(CLAN_LOGO_DIR, file));
    const ext = path.extname(file).slice(1).toLowerCase();
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": ext === "webp" ? "image/webp" : "image/png",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
}
