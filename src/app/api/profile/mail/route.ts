import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { listMailForUser } from "@/lib/profileMail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function currentUserId() {
  const session = await getServerSession(authOptions);
  const steamId = session?.user?.steamId;
  if (!steamId) return null;
  const user = await prisma.user.findUnique({
    where: { steamId },
    select: { id: true },
  });
  return user?.id ?? null;
}

export async function GET() {
  const userId = await currentUserId();
  if (!userId) {
    return NextResponse.json({ error: "Нет доступа" }, { status: 403 });
  }
  const letters = await listMailForUser(userId);
  return NextResponse.json({ letters });
}

export async function PATCH(req: Request) {
  const userId = await currentUserId();
  if (!userId) {
    return NextResponse.json({ error: "Нет доступа" }, { status: 403 });
  }
  const body = (await req.json().catch(() => null)) as {
    id?: string;
    action?: string;
  } | null;
  const mailId = body?.id?.trim() || "";
  const action = body?.action || "";
  if (!mailId || !["read", "favorite", "unfavorite", "delete"].includes(action)) {
    return NextResponse.json({ error: "Некорректное письмо" }, { status: 400 });
  }
  const row = await prisma.profileMailRecipient.findUnique({
    where: { mailId_userId: { mailId, userId } },
  });
  if (!row) {
    return NextResponse.json({ error: "Письмо не найдено" }, { status: 404 });
  }
  const now = new Date();
  if (action === "read") {
    if (!row.readAt) {
      await prisma.profileMailRecipient.update({
        where: { id: row.id },
        data: { readAt: now },
      });
    }
  } else if (action === "favorite") {
    await prisma.profileMailRecipient.update({
      where: { id: row.id },
      data: { favoritedAt: now, readAt: row.readAt ?? now, deletedAt: null },
    });
  } else if (action === "unfavorite") {
    await prisma.profileMailRecipient.update({
      where: { id: row.id },
      data: { favoritedAt: null },
    });
  } else if (action === "delete") {
    await prisma.profileMailRecipient.update({
      where: { id: row.id },
      data: {
        deletedAt: now,
        readAt: row.readAt ?? now,
        favoritedAt: null,
      },
    });
  }
  const letters = await listMailForUser(userId);
  return NextResponse.json({ letters });
}
