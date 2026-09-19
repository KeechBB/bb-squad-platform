export type ClanRole =
  | "LEADER"
  | "DEPUTY"
  | "MAIN"
  | "SUB"
  | "RESERVE"
  | "MEMBER";

export const CLAN_ROLE_LABEL: Record<ClanRole, string> = {
  LEADER: "Глава клана",
  DEPUTY: "Заместитель главы клана",
  MAIN: "Основной состав",
  SUB: "Замена",
  RESERVE: "Резерв",
  MEMBER: "Обычный игрок",
};

/** Роли, которые заместитель может выдавать (не трогает зам. и главу) */
export const DEPUTY_ASSIGNABLE: ClanRole[] = [
  "MAIN",
  "SUB",
  "RESERVE",
  "MEMBER",
];

/** Только глава выдаёт и снимает заместителя */
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

/** Сменить роль участника: зам. нельзя трогать никому, кроме главы */
export function canChangeClanMemberRole(
  actor: ClanRole,
  targetCurrent: ClanRole,
  newRole: ClanRole
): boolean {
  if (targetCurrent === "LEADER") return false;
  if (actor === "LEADER") {
    return canAssignClanRole("LEADER", newRole);
  }
  if (actor === "DEPUTY") {
    if (targetCurrent === "DEPUTY" || newRole === "DEPUTY") return false;
    return canAssignClanRole("DEPUTY", newRole);
  }
  return false;
}

export function canKickClanMember(actor: ClanRole, target: ClanRole): boolean {
  if (target === "LEADER") return false;
  if (target === "DEPUTY") return actor === "LEADER";
  if (actor === "LEADER" || actor === "DEPUTY") return true;
  return false;
}

export function canDeleteClan(role: ClanRole): boolean {
  return role === "LEADER";
}

export function canDeleteClanSquad(role: ClanRole): boolean {
  return role === "LEADER" || role === "DEPUTY";
}

export function isValidClanTag(tag: string): boolean {
  return /^[A-Za-z0-9]{2,8}$/.test(tag.trim());
}

export function isValidClanName(name: string): boolean {
  const t = name.trim();
  return t.length >= 2 && t.length <= 40;
}
