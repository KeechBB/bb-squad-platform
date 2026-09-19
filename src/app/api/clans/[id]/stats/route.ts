import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { buildClanKvStats } from "@/lib/kvStats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const clan = await prisma.clan.findUnique({
    where: { id },
    select: { tag: true, name: true },
  });
  if (!clan) {
    return NextResponse.json({ error: "Клан не найден" }, { status: 404 });
  }

  try {
    const stats = await buildClanKvStats(clan.tag);
    return NextResponse.json({
      ok: true,
      clan: { tag: clan.tag, name: clan.name },
      stats,
    });
  } catch (e) {
    return NextResponse.json(
      {
        error: "Не удалось загрузить КВ",
        detail: e instanceof Error ? e.message : String(e),
      },
      { status: 502 }
    );
  }
}
