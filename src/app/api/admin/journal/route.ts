import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/requireAdmin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const gate = await requireAdmin();
  if (gate.error) return gate.error;

  const url = new URL(req.url);
  const q = String(url.searchParams.get("q") || "").trim();
  const category = String(url.searchParams.get("category") || "").trim();
  const limitRaw = Number(url.searchParams.get("limit") || "200");
  const limit = Math.min(500, Math.max(20, Number.isFinite(limitRaw) ? limitRaw : 200));
  const before = String(url.searchParams.get("before") || "").trim();

  const where: {
    category?: string;
    searchText?: { contains: string; mode: "insensitive" };
    createdAt?: { lt: Date };
  } = {};

  if (category === "admin" || category === "clan" || category === "profile") {
    where.category = category;
  }
  if (q) {
    where.searchText = { contains: q.toLowerCase(), mode: "insensitive" };
  }
  if (before) {
    const d = new Date(before);
    if (!Number.isNaN(d.getTime())) where.createdAt = { lt: d };
  }

  const entries = await prisma.actionLog.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  // В чате — снизу новее: отдаём хронологически (старые → новые)
  const chronological = [...entries].reverse();

  return NextResponse.json({
    entries: chronological,
    hasMore: entries.length >= limit,
  });
}
