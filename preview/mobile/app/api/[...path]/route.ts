import { NextRequest, NextResponse } from "next/server";
import { session, shell, profileView, emptyProfileView, history, cwCards, rating, publicMatches, updatedAt } from "../../../fixtures";
import { clan, members, faction, adminUsers, tournamentHub } from "../../../features";

export const dynamic = "force-dynamic";

export function GET(req: NextRequest) {
  const route = req.nextUrl.pathname;
  const empty = req.cookies.get("bb-preview-state")?.value === "empty";
  const json = (data: unknown) => NextResponse.json(data, { headers: { "Cache-Control": "no-store", "X-BB-Preview": "fixture" } });
  switch (route) {
    case "/api/auth/session": return json(session);
    case "/api/profile/shell": return json(shell);
    case "/api/profile/reserve": return json({ pending: null });
    case "/api/support/tickets": return json({ ok: true, staff: false, myNick: "DemoRaven", welcome: "Локальный preview поддержки. Отправка сообщений отключена.", ticket: null, inbox: [] });
    case "/api/map/pins": return json({ groups: [], myPin: null, myUserId: "preview-player", canModerate: false, clanMemberCount: 36, pinCount: 0 });
    case "/api/clans/preview-clan": return json({ clan, members: empty ? [] : members, myRole: "MEMBER", canManage: false, canApply: false, myPendingRequestId: null });
    case "/api/clans/preview-clan/titles": return json({ titles: [] });
    case "/api/clans/preview-clan/squads": return json({ squads: [] });
    case "/api/clans/preview-clan/join-requests": return json({ requests: [] });
    case "/api/clans/preview-clan/factions": return json({ factions: [{ ...faction, href: "/factions/demo-vanguard", members: faction.members.length }], candidates: [] });
    case "/api/admin/users": return json({ users: empty ? [] : adminUsers });
    case "/api/admin/attendance": return json({ from: updatedAt.slice(0, 10), to: updatedAt.slice(0, 10), days: [], rows: [], stats: { totalMinutes: 0, avgSessionMin: 0, uniquePlayers: 0, leaveBucket: {}, joinBucket: {}, weekday: [], dayPlayerCounts: [], avgPlayersPerDay: 0 } });
    case "/api/admin/attendance-streaks": return json({ registered: 0, anchorYmd: updatedAt.slice(0, 10), missedToday: 0, missByDays: {}, rows: [], top10: [], updatedAt });
    case "/api/admin/bb-train-report": return json({ dates: [], date: updatedAt.slice(0, 10), slot: "0100", report: null });
    case "/api/admin/panelka": return json({ ok: true, servers: [], lines: [], teams: [] });
    case "/api/cw-challenges": return json({ rows: [], challenges: [], myClanId: "preview-clan", mySquads: [], canCreate: true, canManage: true });
    case "/api/tm/sapper-rating": return json({ updatedAt, filesScanned: [], notes: [], membersMatched: 0, rows: [] });
    case "/api/admin/journal": return json({ entries: [], hasMore: false });
    case "/api/admin/releases": return json({ releases: [] });
    case "/api/admin/faction-log": return json({ entries: [], rows: [], hasMore: false });
    case "/api/admin/reserve":
    case "/api/admin/day-off": return json({ players: [], requests: [], total: 0, inReserveCount: 0, inDayOffCount: 0 });
    case "/api/admin/visits": return json({ users: [], summary: null, traffic: null });
    case "/api/admin/load": return json({ range: "minutes", now: null, series: [], sampleCount: 0 });
    case "/api/admin/mail": return json({ players: [], recipients: [], count: 0 });
    case "/api/tournaments/teams": return json({ teams: [], myTeamId: null, myRole: null, myUserId: "preview-player", canCreate: true, authed: true });
    case "/api/tournaments/live": return json({ matches: {}, updatedAt });
    case "/api/tournaments/entries": return json({ entries: [], myEntry: null, team: null, canRegister: false });
    case "/api/tournaments/bets": return json({ locked: true, closesAt: "2026-10-31T15:59:00Z", authed: true, needsProfile: false, pointsEach: 100, lockNote: "Тестовый preview", tournamentName: tournamentHub.tournamentName, graded: 0, reveal: { open: false, champion: null, answers: {}, lines: {} }, mine: null, board: [], teams: [], maps: [] });
    case "/api/reaction/presence": return json({ players: [] });
    case "/api/reaction/run": return json({ runs: [], bestAvgMs: empty ? null : 243 });
    case "/api/reaction/leaderboard": return json({ rows: [], leaderboard: [] });
    case "/api/reaction/chat": return json({ messages: [], windowStart: updatedAt });
    case "/api/factions/demo-vanguard": return json({ ...faction, members: empty ? [] : faction.members });
    case "/api/factions/demo-vanguard/online": return json({ rows: [] });
    case "/api/factions/demo-vanguard/week": return json({ rows: [] });
    case "/api/factions/demo-vanguard/growth": return json({ rows: [] });
    case "/api/factions/demo-vanguard/analytics": return json({ slices: [], roles: [] });
    case "/api/factions/demo-vanguard/ratings": return json({ charts: [] });
    case "/api/profile/view-data": return json(empty ? emptyProfileView : profileView);
    case "/api/me/admin": return json({ admin: false });
    case "/api/presence/online": return json({ online: empty ? 0 : 24, count: empty ? 0 : 24 });
    case "/api/notices": return json({ notices: [] });
    case "/api/tournaments/invites":
    case "/api/factions/invites": return json({ invites: [] });
    case "/api/profile/mail": return json({ letters: empty ? [] : [{
      id: "preview-letter", title: "Добро пожаловать в команду", body: "Встречаемся на тренировке в 21:00 МСК. Это вымышленное письмо для проверки интерфейса.",
      senderKind: "system", senderLabel: "BlackBerry", tags: ["Тренировка"],
      createdAt: updatedAt, read: false, favorite: false, deleted: false,
    }] });
    case "/api/profile/bp": return json({ season: "Тестовый сезон", level: 8, title: "Поддержка отряда", task: "Поднимите союзников", unit: "ресов", current: 34, target: 50, done: false, maxLevel: 20 });
    case "/api/career": return json({ nick: "DemoRaven", updatedAt, events: empty ? [] : [
      { id: "career-1", tone: "win", title: "Победа на Narva", body: "Слаженная работа отряда", rpNet: 24, at: updatedAt, atLabel: "Сегодня · 22:15" },
      { id: "career-2", tone: "mvp", title: "Лучший стрелок матча", body: "24 устранения за тренировку", at: updatedAt, atLabel: "Сегодня · 21:40" },
    ] });
    case "/api/kits": return json({ kits: empty ? [] : [
      { kit: "Стрелок", pct: 55, count: 12, minutes: 302 },
      { kit: "Медик", pct: 30, count: 7, minutes: 165 },
      { kit: "Командир отряда", pct: 15, count: 3, minutes: 83 },
    ], total: empty ? 0 : 550, days: [], basis: "time" });
    case "/api/hitmap": return json({ bones: empty ? {} : { Bip01_Head: 42, Bip01_Spine2: 76, Bip01_Pelvis: 28, Bip01_L_UpperArm: 16 }, lastBone: null });
    case "/api/hitmap/matches": return json({ matches: empty ? [] : history });
    case "/api/accuracy": return json({ accuracyPct: empty ? null : 23.4 });
    case "/api/profile/mvp-matches": return json({ killer: [], medic: [], armor: [] });
    case "/api/cw-announce": return json({ cards: empty ? [] : cwCards });
    case "/api/public/clans": return json({ clans: empty ? [] : [{ tag: "BB", name: "BlackBerry" }] });
    case "/api/public/rating-page": {
      const clan = req.nextUrl.searchParams.get("clan");
      return json({ rows: empty ? [] : rating.filter((row) => !clan || row.clan === clan), matches: empty ? 0 : 12, matchHistory: empty ? [] : publicMatches, updatedAt });
    }
    case "/api/players/search": return json({ results: empty ? [] : [{ nick: "DemoRaven", steamId: "00000000000000001", name: "Demo Player", avatarUrl: "/blackberry.png" }] });
    case "/api/factions": return json({ factions: empty ? [] : [{ id: "preview-faction", name: "Demo Vanguard", slug: "demo-vanguard", href: "/factions/demo-vanguard", logoUrl: "/blackberry.png", mine: true }] });
    case "/api/profile/history": {
      const page = Math.max(1, Number(req.nextUrl.searchParams.get("page")) || 1);
      const size = Math.max(1, Math.min(50, Number(req.nextUrl.searchParams.get("pageSize")) || 5));
      const rows = empty || req.nextUrl.searchParams.get("kind") === "cw" ? [] : history;
      return json({ rows: rows.slice((page - 1) * size, page * size), total: rows.length, pageCount: Math.max(1, Math.ceil(rows.length / size)) });
    }
  }
  if (route.startsWith("/api/live/")) {
    return new Response("retry: 60000\n: local preview has no live backend\n\n", { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store" } });
  }
  return NextResponse.json({ error: `No local fixture for ${route}` }, { status: 501 });
}

// Never forward writes to real APIs. Unsupported actions remain explicit.
function readOnly() {
  return NextResponse.json({ error: "Локальный preview: сохранение и вход через Steam отключены." }, { status: 405, headers: { Allow: "GET" } });
}
export function POST(req: NextRequest) {
  if (req.nextUrl.pathname === "/api/reaction/presence") return NextResponse.json({ ok: true });
  return readOnly();
}
export const PATCH = readOnly;
export const PUT = readOnly;
export const DELETE = readOnly;
