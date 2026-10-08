import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Было: авто-карточка чужого клана после КВ.
 * С 08.10.2026 выключено — кланы создают карточки сами на сайте.
 */
export async function POST(req: Request) {
  const secret = process.env.SQUAD_INGEST_SECRET?.trim();
  if (!secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const auth = req.headers.get("authorization") || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (bearer !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  return NextResponse.json({
    ok: false,
    disabled: true,
    reason:
      "Автосоздание карточек кланов после КВ отключено. Клан создаёт карточку сам на /clans.",
  });
}
