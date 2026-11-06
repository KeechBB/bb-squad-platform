import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/admin";
import {
  bookClanWar,
  parseDateDm,
  parseSize,
  parseTeamLine,
  parseTimeHm,
  type CwBookInput,
} from "@/lib/cwBook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Админ: зарегистрировать будущую КВ в календарь + match.md.
 * Body — либо готовые поля, либо сырые ответы визарда.
 */
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.steamId || !session.user.profileComplete) {
    return NextResponse.json({ error: "auth" }, { status: 401 });
  }
  if (!(await isAdmin(session.user.steamId))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (!body) {
    return NextResponse.json({ error: "body" }, { status: 400 });
  }

  const nowY = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Moscow",
      year: "numeric",
    }).format(new Date())
  );

  let stack: "Main" | "Junior" | "—" = "Main";
  let opp = String(body.opp || "").trim();
  let clan = String(body.clan || "").trim();
  if (body.teamLine || body.team) {
    const parsed = parseTeamLine(String(body.teamLine || body.team || ""));
    if (!parsed) {
      return NextResponse.json(
        {
          error: "team",
          hint: "BB: Main vs 20Royals · чужой: NKLV vs RA",
        },
        { status: 400 }
      );
    }
    stack = parsed.stack;
    opp = parsed.opp;
    clan = parsed.clan || "";
  } else if (body.stack) {
    stack = /jun/i.test(String(body.stack))
      ? "Junior"
      : String(body.stack).trim() === "—"
        ? "—"
        : "Main";
  }
  if (!opp) {
    return NextResponse.json({ error: "opp" }, { status: 400 });
  }
  if (clan && !opp) {
    return NextResponse.json({ error: "opp" }, { status: 400 });
  }

  let format = Number(body.format);
  if (!Number.isFinite(format) || format < 8) {
    const fromSize = parseSize(String(body.size || ""));
    if (!fromSize) {
      return NextResponse.json(
        { error: "size", hint: "Формат: 26v26" },
        { status: 400 }
      );
    }
    format = fromSize;
  }

  let day = Number(body.day);
  let month = body.month != null ? Number(body.month) : undefined;
  let year = body.year != null ? Number(body.year) : undefined;
  if (!Number.isFinite(day) || day < 1) {
    const d = parseDateDm(String(body.date || ""), nowY);
    if (!d) {
      return NextResponse.json(
        { error: "date", hint: "Формат: 08.11 или 08.11.2026" },
        { status: 400 }
      );
    }
    day = d.day;
    month = d.month;
    year = d.year;
  }

  let timeUtc = String(body.timeUtc || "").trim();
  if (!parseTimeHm(timeUtc)) {
    const raw = String(body.time || body.timeUtc || "").trim();
    // "17:00 UTC" / "17:00"
    const cleaned = raw.replace(/\s*UTC\s*$/i, "").trim();
    if (!parseTimeHm(cleaned)) {
      return NextResponse.json(
        { error: "time", hint: "Формат: 17:00 UTC" },
        { status: 400 }
      );
    }
    timeUtc = cleaned;
  }

  const map = String(body.map || "").trim();
  const server = String(body.server || "").trim();
  const rules = String(body.rules || body.mode || "")
    .trim()
    .toUpperCase();
  if (!map || !server || !rules) {
    return NextResponse.json(
      { error: "fields", hint: "Нужны карта, сервер и правила" },
      { status: 400 }
    );
  }

  const input: CwBookInput = {
    stack: clan ? "—" : stack === "Junior" ? "Junior" : "Main",
    opp,
    ...(clan ? { clan } : {}),
    format,
    day,
    month,
    year,
    timeUtc,
    map,
    server,
    rules,
  };

  const result = await bookClanWar(input);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error || "write_failed", ...result },
      { status: 500 }
    );
  }
  return NextResponse.json(result);
}
