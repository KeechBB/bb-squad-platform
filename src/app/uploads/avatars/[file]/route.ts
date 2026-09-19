import { NextResponse } from "next/server";
import { readAvatarFile } from "@/lib/avatar";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ file: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { file } = await ctx.params;
  const data = await readAvatarFile(file);
  if (!data) {
    return new NextResponse("Not found", { status: 404 });
  }
  return new NextResponse(new Uint8Array(data.buf), {
    headers: {
      "Content-Type": data.contentType,
      "Cache-Control": "public, max-age=86400, immutable",
    },
  });
}
