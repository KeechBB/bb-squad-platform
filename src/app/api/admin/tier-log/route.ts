import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/requireAdmin";
import { personLabel } from "@/lib/actionLog";
import {
  ensureTierChangeSeeds,
  recordTierChange,
  tierLabel,
} from "@/lib/tierChangeLog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseTier(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return null;
  const t = Math.round(n);
  if (t < 1 || t > 4) return null;
  return t;
}

/** GET — лог смен тиров (с сидом известных повышений). */
export async function GET(req: Request) {
  const gate = await requireAdmin();
  if (gate.error) return gate.error;

  await ensureTierChangeSeeds();

  const url = new URL(req.url);
  const q = String(url.searchParams.get("q") || "").trim().toLowerCase();
  const limitRaw = Number(url.searchParams.get("limit") || "300");
  const limit = Math.min(500, Math.max(20, Number.isFinite(limitRaw) ? limitRaw : 300));

  const rows = await prisma.tierChangeLog.findMany({
    where: q
      ? {
          OR: [
            { nick: { contains: q, mode: "insensitive" } },
            { note: { contains: q, mode: "insensitive" } },
            { actorNick: { contains: q, mode: "insensitive" } },
          ],
        }
      : undefined,
    orderBy: [{ changedAt: "desc" }, { createdAt: "desc" }],
    take: limit,
  });

  return NextResponse.json({
    entries: rows.map((r) => ({
      id: r.id,
      changedAt: r.changedAt.toISOString(),
      nick: r.nick,
      fromTier: r.fromTier,
      toTier: r.toTier,
      fromLabel: tierLabel(r.fromTier),
      toLabel: tierLabel(r.toTier),
      note: r.note,
      batchKey: r.batchKey,
      actorNick: r.actorNick,
      createdAt: r.createdAt.toISOString(),
    })),
  });
}

/** POST — ручная запись перевода. */
export async function POST(req: Request) {
  const gate = await requireAdmin();
  if (gate.error) return gate.error;

  const body = (await req.json().catch(() => null)) as {
    nick?: string;
    fromTier?: number;
    toTier?: number;
    date?: string;
    note?: string;
  } | null;

  const nick = String(body?.nick || "").trim();
  const fromTier = parseTier(body?.fromTier);
  const toTier = parseTier(body?.toTier);
  if (!nick) {
    return NextResponse.json({ error: "Укажи ник" }, { status: 400 });
  }
  if (fromTier == null || toTier == null) {
    return NextResponse.json(
      { error: "Тиры должны быть 1–4 (4 = вне состава)" },
      { status: 400 }
    );
  }
  if (fromTier === toTier) {
    return NextResponse.json(
      { error: "Тир не изменился — запись не нужна" },
      { status: 400 }
    );
  }

  let changedAt = new Date();
  const dateRaw = String(body?.date || "").trim();
  if (dateRaw) {
    // YYYY-MM-DD or DD.MM.YYYY
    let ymd = dateRaw;
    const mRu = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(dateRaw);
    if (mRu) ymd = `${mRu[3]}-${mRu[2]}-${mRu[1]}`;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
      return NextResponse.json(
        { error: "Дата: ГГГГ-ММ-ДД или ДД.ММ.ГГГГ" },
        { status: 400 }
      );
    }
    const [y, m, d] = ymd.split("-").map(Number);
    changedAt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  }

  const steamId = gate.session!.user.steamId;
  const actor = await prisma.user.findUnique({
    where: { steamId },
    select: { id: true, nick: true, name: true, steamName: true, steamId: true },
  });
  const actorNick = actor ? personLabel(actor) : steamId;

  const row = await recordTierChange({
    nick,
    fromTier,
    toTier,
    changedAt,
    note: body?.note || null,
    actorId: actor?.id ?? null,
    actorNick,
  });

  return NextResponse.json({
    ok: true,
    entry: {
      id: row.id,
      changedAt: row.changedAt.toISOString(),
      nick: row.nick,
      fromTier: row.fromTier,
      toTier: row.toTier,
      fromLabel: tierLabel(row.fromTier),
      toLabel: tierLabel(row.toTier),
      note: row.note,
      actorNick: row.actorNick,
    },
  });
}
