import type { FactionView } from "@/lib/factions";
import type { TournamentHubState } from "@/lib/tournamentHubShared";
import { rating, updatedAt } from "./fixtures";

export const clan = { id: "preview-clan", name: "BlackBerry", tag: "BB", logoUrl: "/blackberry.png", isExternal: false };
export const members = rating.map((player, i) => ({
  id: `member-${i}`, role: "MEMBER" as const, joinedAt: updatedAt, title: null,
  user: { id: i === 1 ? "preview-player" : `preview-user-${i}`, nick: player.nick, name: "Demo Player", avatarUrl: "/blackberry.png", steamName: player.nick, steamId: `0000000000000000${i}`, lastSeenAt: updatedAt },
}));
export const faction: FactionView = {
  id: "preview-faction", clanId: clan.id, name: "Demo Vanguard", slug: "demo-vanguard",
  logoUrl: "/blackberry.png", tgUrl: null, info: "Играем вместе, растём как команда. Тренировки в 21:00 МСК.",
  leaderNick: "DemoFalcon", deputyNicks: ["DemoRaven"], roles: [],
  members: members.map((m, i) => ({ id: m.id, userId: m.user.id, nick: m.user.nick, name: m.user.name, seat: i === 0 ? "LEADER" : "MEMBER", roleId: null, roleName: "Стрелок", joinedAt: updatedAt, order: i + 1, mainKit: "Стрелок" })),
  canEditIdentity: true, canManage: true, canEditInfo: true,
  mySeat: "LEADER", myUserId: "preview-player", keech: false, invitePool: [], leaderPool: [],
};
export const tournamentHub: TournamentHubState = {
  surface: "active", tournamentId: "preview-cup", tournamentName: "Demo Cup",
  playDateLabel: "15.11.2026", resultsDateLabel: "16.11.2026", championWindowEndsAt: null, champion: null, places: [], historyCups: [],
};
export const adminUsers = members.map((m, i) => ({
  ...m.user, age: 24, role: "USER" as const, profileComplete: true, regNo: i + 1,
  createdAt: updatedAt, canEditRole: false, canDelete: false,
}));
