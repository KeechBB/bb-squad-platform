import type { Session } from "next-auth";
import type { ProfileViewBundle } from "@/lib/profileViewCache";
import type { PlayerTrainCombatStats, TrainMatchHistoryRow } from "@/lib/homeTrainPwr";
import type { PublicCombatRow } from "@/lib/publicCombat";
import type { HomeCwCard } from "@/components/HomeCwAnnounce";
import { DEFAULT_HUB_TILES, DEFAULT_HUB_PREVIEWS } from "@/lib/homeHubLayoutShared";

// Synthetic identities only. Shift dates with today so calendars remain useful.
export const now = new Date();
export const updatedAt = now.toISOString();
const day = (offset: number) => new Date(now.getTime() - offset * 86400000).toISOString().slice(0, 10);
export const session: Session = {
  expires: "2099-01-01T00:00:00.000Z",
  user: { id: "preview-player", steamId: "00000000000000001", nick: "DemoRaven", name: "Demo Player", steamName: "DemoRaven", profileComplete: true, avatarUrl: "/blackberry.png" },
};
export const shell = {
  ...session.user,
  avatarUrl: "/blackberry.png", steamAvatar: null, profileBg: null,
  profileBgChoices: [], profilePatchChoices: [], profileNickStyleChoices: [],
  medals: [], medalSlots: [null, null, null], medalInventory: [], medalShelfIds: [],
  lastSeenAt: updatedAt, admin: false, isBb: true, kitsLane: "TR1",
  discordTag: "demo.player", discordId: null, telegram: "@demo_player",
  siteRole: "USER", regNo: 42, reserveActive: false, reserveUntilLabel: null,
  reserveReason: null, dayOffActive: false, dayOffUntilLabel: null, dayOffReason: null,
  invites: [], clans: [{ id: "preview-clan", tag: "BB", name: "BlackBerry", logoUrl: "/blackberry.png", membershipLabel: "Участник" }],
};
export const history: TrainMatchHistoryRow[] = Array.from({ length: 12 }, (_, i) => ({
  matchId: `preview-match-${i + 1}`, dateLabel: day(i).split("-").reverse().join("."),
  timeLabel: "21:30", map: ["Narva", "Gorodok", "Mutaha"][i % 3],
  factionA: "USA", ticketsA: i % 3 ? 142 : 0, factionB: "RGF", ticketsB: i % 3 ? 0 : 76,
  team: "USA", winner: i % 3 ? "USA" : "RGF", duration: "42:18", server: "TR1",
  playersUrl: `/preview/match/${i + 1}`, won: Boolean(i % 3), res: 4 + i, nok: 10 + i,
  kills: 12 + i, deaths: 5 + i % 4, rpAfter: 2400 - i * 24, rpDelta: i % 3 ? 24 : -18,
  pwrAfter: 2400 - i * 24, pwrDelta: i % 3 ? 24 : -18, rankLabel: "Diamond II", rankKey: "diamond",
}));
export const combat: PlayerTrainCombatStats = {
  nick: "DemoRaven", matches: 12, wins: 8, losses: 4, kills: 210, deaths: 78,
  dmg: 18340, res: 76, nok: 184, kd: 2.69, avgKills: 17.5, avgDmg: 1528.33,
  winrate: 66.67, mvpDamage: 2, mvpKiller: 3, mvpMedic: 1, antiDeath: 1,
  vehicleKills: 2, mvpArmor: 1, rp: 2400, rankLabel: "Diamond II", rankKey: "diamond",
  mvpHits: { killer: [], medic: [], armor: [] },
};
const lane = {
  sessions: [0, 1, 3, 4, 6].map((i) => ({ id: `session-${i}`, joinedAt: `${day(i)}T17:55:00Z`, leftAt: `${day(i)}T19:45:00Z`, nickAtJoin: "DemoRaven", serverKey: "TR1" })),
  presentDays: [0, 1, 3, 4, 6].map(day), lateDays: [day(3)], reserveDays: [], dayOffDays: [],
  visitBounds: Object.fromEntries([0, 1, 3, 4, 6].map((i) => [day(i), { joinHm: "20:55", leaveHm: "22:45" }])),
  minutes30d: 550, sessions30d: 5, openNow: false,
};
const emptyLane = { sessions: [], presentDays: [], lateDays: [], reserveDays: [], dayOffDays: [], visitBounds: {}, minutes30d: 0, sessions30d: 0, openNow: false };
export const profileView: ProfileViewBundle = {
  trainPwr: { nick: "DemoRaven", rp: 2400, pwr: 2400, rankLabel: "Diamond II", rankKey: "diamond", games: 12, place: 7 },
  publicSummary: { rp: { rp: 2400, rankLabel: "Diamond II", rankKey: "diamond", matches: 12 }, combat },
  training: { ...lane, tr1: lane, tr2: emptyLane }, publicAtt: lane, cwAtt: { byDay: {} },
  stats: { kvStats: null, kvError: null, trainCombat: combat, publicCombat: { ...combat, days: 5 } },
  histories: { trainHistory: history, publicHistory: history, cwHistory: [], trainTotal: 12, publicTotal: 12, cwTotal: 0 },
};
export const emptyProfileView: ProfileViewBundle = {
  trainPwr: null, publicSummary: { rp: null, combat: null },
  training: { ...emptyLane, tr1: emptyLane, tr2: emptyLane }, publicAtt: emptyLane,
  cwAtt: { byDay: {} }, stats: { kvStats: null, kvError: null, trainCombat: null, publicCombat: null },
  histories: { trainHistory: [], publicHistory: [], cwHistory: [], trainTotal: 0, publicTotal: 0, cwTotal: 0 },
};
export const rating: PublicCombatRow[] = ["DemoFalcon", "DemoRaven", "DemoFox", "DemoMedic_With_A_Long_Nickname", "DemoOrbit", "DemoBirch"].map((nick, i) => ({
  place: i + 1, nick, steamId: null, clan: i < 3 ? "BB" : "", rp: 3100 - i * 230,
  rankLabel: i < 2 ? "Diamond II" : "Gold III", rankKey: i < 2 ? "diamond" : "gold",
  games: 18 - i, wins: 12 - i, winPct: 60, res: 36 + i * 12, nok: 180 - i * 8,
  kills: 200 - i * 15, deaths: 90 - i * 4, kd: 2.2, dmg: 17000 - i * 700,
  vehicleKills: i % 3, mvpMedic: i % 2, mvpKiller: 3, mvpDamage: 1, mvpArmor: 0,
  days: 8, hasProfile: true,
}));
export const publicMatches = history.map((m, i) => ({
  id: m.matchId, endedAt: `${day(i)}T19:45:00Z`, mapName: m.map,
  layerName: `${m.map}_AAS_v1`, serverKey: "PB1", serverLabel: "PB1",
  faction1: "USA", faction1Side: "A", score1: m.ticketsA || 0,
  faction2: "RGF", faction2Side: "B", score2: m.ticketsB || 0,
  winnerTeam: m.won ? 1 : 2, winnerName: m.won ? "USA" : "RGF",
}));
export const cwCards: HomeCwCard[] = [{
  id: "preview-cw", stack: "Main", dateLabel: day(-1).split("-").reverse().join("."),
  timeMsk: "21:00", opp: "Demo Wolves", map: "Gorodok", size: "36 × 36",
  server: "TR1", rules: "AAS", ready: ["DemoRaven", "DemoFox", "DemoMedic"], going: true,
}];
export const hubLayout = { locked: true, updatedAt: null, tiles: DEFAULT_HUB_TILES, previews: DEFAULT_HUB_PREVIEWS };
