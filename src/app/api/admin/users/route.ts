import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/requireAdmin";
import type { Prisma } from "@prisma/client";

export const runtime = "nodejs";

const SORT_FIELDS = ["createdAt", "nick", "name", "age", "steamId"] as const;
type SortField = (typeof SORT_FIELDS)[number];

export async function GET(req: Request) {
  const { error } = await requireAdmin();
  if (error) return error;

  const url = new URL(req.url);
  const q = (url.searchParams.get("q") || "").trim();
  const sortRaw = url.searchParams.get("sort") || "createdAt";
  const orderRaw = url.searchParams.get("order") || "desc";
  const sort: SortField = SORT_FIELDS.includes(sortRaw as SortField)
    ? (sortRaw as SortField)
    : "createdAt";
  const order = orderRaw === "asc" ? "asc" : "desc";

  const where: Prisma.UserWhereInput = q
    ? {
        OR: [
          { nick: { contains: q, mode: "insensitive" } },
          { name: { contains: q, mode: "insensitive" } },
          { steamId: { contains: q } },
          { steamName: { contains: q, mode: "insensitive" } },
        ],
      }
    : {};

  const users = await prisma.user.findMany({
    where,
    orderBy: { [sort]: order },
    select: {
      id: true,
      steamId: true,
      steamName: true,
      steamAvatar: true,
      avatarUrl: true,
      name: true,
      nick: true,
      age: true,
      role: true,
      profileComplete: true,
      createdAt: true,
    },
  });

  return NextResponse.json({ users, total: users.length });
}
