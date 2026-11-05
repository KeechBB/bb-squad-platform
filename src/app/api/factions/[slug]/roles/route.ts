import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { loadFactionView } from "@/lib/factions";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ slug: string }> };

export async function POST(req: Request, ctx: Ctx) {
  const session = await getServerSession(authOptions);
  const { slug } = await ctx.params;
  const loaded = await loadFactionView(decodeURIComponent(slug), session?.user?.steamId ?? null);
  if (loaded.error || !loaded.view?.canManage) {
    return NextResponse.json({ error: "Нет доступа" }, { status: 404 });
  }
  const body = (await req.json().catch(() => null)) as { name?: string } | null;
  const name = String(body?.name || "").trim();
  if (name.length < 2 || name.length > 32) {
    return NextResponse.json({ error: "Название роли от 2 до 32 символов" }, { status: 400 });
  }
  const clash = await prisma.factionRole.findFirst({
    where: { factionId: loaded.view.id, name },
  });
  if (clash) return NextResponse.json({ error: "Такая роль уже есть" }, { status: 409 });
  const sort = await prisma.factionRole.count({ where: { factionId: loaded.view.id } });
  await prisma.factionRole.create({
    data: { factionId: loaded.view.id, name, sortOrder: sort, isDeputy: false },
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request, ctx: Ctx) {
  const session = await getServerSession(authOptions);
  const { slug } = await ctx.params;
  const loaded = await loadFactionView(decodeURIComponent(slug), session?.user?.steamId ?? null);
  if (loaded.error || !loaded.view?.canManage) {
    return NextResponse.json({ error: "Нет доступа" }, { status: 404 });
  }
  const roleId = new URL(req.url).searchParams.get("roleId") || "";
  const role = await prisma.factionRole.findFirst({
    where: { id: roleId, factionId: loaded.view.id },
  });
  if (!role) return NextResponse.json({ error: "Роль не найдена" }, { status: 404 });
  if (role.isDeputy) {
    return NextResponse.json({ error: "Роль зама не удаляется" }, { status: 403 });
  }
  await prisma.factionRole.delete({ where: { id: role.id } });
  return NextResponse.json({ ok: true });
}
