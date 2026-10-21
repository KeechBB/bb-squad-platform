import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";
import { TEAM_LOGO_DIR } from "@/lib/tournamentTeamLogoFile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ file: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { file } = await ctx.params;
  if (!/^[a-z0-9_-]+\.(png|webp|jpe?g)$/i.test(file)) {
    return new NextResponse("Not found", { status: 404 });
  }
  try {
    const buf = await readFile(path.join(TEAM_LOGO_DIR, file));
    const ext = path.extname(file).slice(1).toLowerCase();
    const contentType =
      ext === "webp"
        ? "image/webp"
        : ext === "jpg" || ext === "jpeg"
          ? "image/jpeg"
          : "image/png";
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
      },
    });
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
}
