import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isBuiltinSuperAdmin } from "@/lib/admin";
import {
  CW_MATCH_STATUSES,
  updateClanWarMatch,
} from "@/lib/cwBook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Только Keech: правка слота КВ в календаре месяца.
 * GET — можно ли править + список статусов.
 * PATCH — обновить поля матча по id.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  const steamId = session?.user?.steamId || null;
  const canEdit = Boolean(
    steamId && session?.user?.profileComplete && isBuiltinSuperAdmin(steamId)
  );
  return NextResponse.json({
    canEdit,
    statuses: CW_MATCH_STATUSES.map((id) => ({
      id,
      label:
        id === "upcoming"
          ? "скоро"
          : id === "tba"
            ? "Уточняется"
            : id === "win"
              ? "победа"
              : id === "lose"
                ? "поражение"
                : id === "draw"
                  ? "ничья"
                  : id === "cancel"
                    ? "отмена"
                    : id === "move"
                      ? "перенос"
                      : id === "r1"
                        ? "раунд 1"
                        : id,
    })),
  });
}

export async function PATCH(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.steamId || !session.user.profileComplete) {
    return NextResponse.json({ error: "auth" }, { status: 401 });
  }
  if (!isBuiltinSuperAdmin(session.user.steamId)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (!body) {
    return NextResponse.json({ error: "body" }, { status: 400 });
  }

  const id = String(body.id || "").trim();
  const year = Number(body.year);
  const month = Number(body.month);
  if (!id) return NextResponse.json({ error: "id" }, { status: 400 });
  if (!Number.isFinite(year) || !Number.isFinite(month)) {
    return NextResponse.json({ error: "ym" }, { status: 400 });
  }

  let day: number | undefined;
  if (body.day != null && String(body.day).trim() !== "") {
    day = Number(body.day);
  } else if (body.date != null) {
    const raw = String(body.date).trim();
    const m = raw.match(/^(\d{1,2})(?:[./-](\d{1,2}))?/);
    if (m) day = Number(m[1]);
  }

  const result = await updateClanWarMatch({
    id,
    year,
    month,
    day,
    timeMsk:
      body.timeMsk != null
        ? String(body.timeMsk)
        : body.time != null
          ? String(body.time)
          : undefined,
    timeUtc: body.timeUtc != null ? String(body.timeUtc) : undefined,
    clan: body.clan != null ? String(body.clan) : undefined,
    opp: body.opp != null ? String(body.opp) : undefined,
    map: body.map != null ? String(body.map) : undefined,
    size: body.size != null ? String(body.size) : undefined,
    server: body.server != null ? String(body.server) : undefined,
    stack: body.stack != null ? String(body.stack) : undefined,
    rules: body.rules != null ? String(body.rules) : undefined,
    mode: body.mode != null ? String(body.mode) : undefined,
    status: body.status != null ? String(body.status) : undefined,
    r1: body.r1 != null ? String(body.r1) : undefined,
    r2: body.r2 != null ? String(body.r2) : undefined,
    meeting: body.meeting != null ? String(body.meeting) : undefined,
    note: body.note != null ? String(body.note) : undefined,
  });

  if (!result.ok) {
    return NextResponse.json(result, { status: 400 });
  }
  return NextResponse.json(result);
}
