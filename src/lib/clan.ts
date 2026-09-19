export type ClanRole =
  | "LEADER"
  | "DEPUTY"
  | "MAIN"
  | "SUB"
  | "RESERVE"
  | "MEMBER";

export const CLAN_ROLE_LABEL: Record<ClanRole, string> = {
  LEADER: "Глава клана",
  DEPUTY: "Заместитель главы",
  MAIN: "Основной состав",
  SUB: "Замена",
  RESERVE: "Резерв",
  MEMBER: "Обычный игрок",
};

/** Роли, которые заместитель может выдавать (включительно до MAIN) */
export const DEPUTY_ASSIGNABLE: ClanRole[] = [
  "MAIN",
  "SUB",
  "RESERVE",
  "MEMBER",
];

export const LEADER_ASSIGNABLE: ClanRole[] = [
  "DEPUTY",
  "MAIN",
  "SUB",
  "RESERVE",
  "MEMBER",
];

export function assignableClanRoles(actor: ClanRole): ClanRole[] {
  if (actor === "LEADER") return LEADER_ASSIGNABLE;
  if (actor === "DEPUTY") return DEPUTY_ASSIGNABLE;
  return [];
}

export function canManageClanMembers(role: ClanRole): boolean {
  return role === "LEADER" || role === "DEPUTY";
}

export function canAssignClanRole(actor: ClanRole, targetRole: ClanRole): boolean {
  return assignableClanRoles(actor).includes(targetRole);
}

export function canKickClanMember(actor: ClanRole, target: ClanRole): boolean {
  if (target === "LEADER") return false;
  if (actor === "LEADER") return true;
  if (actor === "DEPUTY") {
    return target !== "DEPUTY";
  }
  return false;
}

export function isValidClanTag(tag: string): boolean {
  return /^[A-Za-z0-9]{2,8}$/.test(tag.trim());
}

export function isValidClanName(name: string): boolean {
  const t = name.trim();
  return t.length >= 2 && t.length <= 40;
}
