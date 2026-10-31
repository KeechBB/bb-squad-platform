import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { readMailImage } from "@/lib/mailImage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ file: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const session = await getSession();
  if (!session?.user?.steamId) {
    return new NextResponse("Нет доступа", { status: 403 });
  }
  const { file } = await ctx.params;
  const data = await readMailImage(file);
  if (!data) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(new Uint8Array(data.buf), {
    headers: {
      "Content-Type": data.contentType,
      "Cache-Control": "private, max-age=86400",
    },
  });
}
