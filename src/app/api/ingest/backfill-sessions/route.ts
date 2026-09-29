import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function checkSecret(req: Request): boolean {
  const secret = process.env.SQUAD_INGEST_SECRET?.trim();
  if (!secret) return false;
  const auth = req.headers.get("authorization") || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const header = req.headers.get("x-squad-ingest-secret")?.trim() || "";
  return bearer === secret || header === secret;
}

function unauthorized() {
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

/** Collector: взять до N pending-задач в работу. */
export async function GET(req: Request) {
  if (!checkSecret(req)) return unauthorized();
  const url = new URL(req.url);
  const limit = Math.min(10, Math.max(1, Number(url.searchParams.get("limit") || 3)));

  const pending = await prisma.squadLogBackfillJob.findMany({
    where: { status: "pending" },
    orderBy: { createdAt: "asc" },
    take: limit,
  });

  const claimed = [];
  for (const job of pending) {
    const updated = await prisma.squadLogBackfillJob.updateMany({
      where: { id: job.id, status: "pending" },
      data: { status: "running", startedAt: new Date(), error: null },
    });
    if (updated.count === 1) {
      claimed.push({
        id: job.id,
        userId: job.userId,
        steamId: job.steamId,
        nick: job.nick,
      });
    }
  }
  return NextResponse.json({ ok: true, jobs: claimed });
}

type Body = {
  /** Создать задачу (register / admin) */
  enqueue?: { userId: string; steamId: string; nick?: string | null };
  /** Завершить задачу */
  complete?: { id: string; ok: boolean; error?: string | null };
};

export async function POST(req: Request) {
  if (!checkSecret(req)) return unauthorized();

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  if (body.enqueue) {
    const steamId = String(body.enqueue.steamId || "").trim();
    const userId = String(body.enqueue.userId || "").trim();
    const nick = body.enqueue.nick ? String(body.enqueue.nick).trim() : null;
    if (!steamId || !userId) {
      return NextResponse.json({ error: "userId+steamId required" }, { status: 400 });
    }
    // Не плодим дубли, если уже есть pending/running на этот steam
    const existing = await prisma.squadLogBackfillJob.findFirst({
      where: {
        steamId,
        status: { in: ["pending", "running"] },
      },
      select: { id: true },
    });
    if (existing) {
      return NextResponse.json({ ok: true, id: existing.id, deduped: true });
    }
    const job = await prisma.squadLogBackfillJob.create({
      data: { userId, steamId, nick, status: "pending" },
    });
    return NextResponse.json({ ok: true, id: job.id });
  }

  if (body.complete) {
    const id = String(body.complete.id || "").trim();
    if (!id) {
      return NextResponse.json({ error: "id required" }, { status: 400 });
    }
    const ok = Boolean(body.complete.ok);
    await prisma.squadLogBackfillJob.update({
      where: { id },
      data: {
        status: ok ? "done" : "error",
        doneAt: new Date(),
        error: ok ? null : String(body.complete.error || "failed").slice(0, 500),
      },
    });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "enqueue or complete required" }, { status: 400 });
}
