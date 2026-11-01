import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "public, max-age=60, s-maxage=120",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

/** Живые кланы сайта (не карточки соперников) — для фильтра рейтингов. */
export async function GET() {
  const clans = await prisma.clan.findMany({
    where: { isExternal: false },
    select: { tag: true, name: true },
    orderBy: { tag: "asc" },
  });
  return NextResponse.json(
    {
      clans: clans
        .filter((c) => c.tag)
        .map((c) => ({ tag: c.tag, name: c.name })),
    },
    { headers: CORS }
  );
}
