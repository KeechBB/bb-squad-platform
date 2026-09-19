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

/** Роли, которые зам и HR могут выдавать (не трогают зам. и главу) */
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

function isHrTitle(titleName: string | null | undefined): boolean {
  return Boolean(titleName && titleName.toLowerCase() === "hr");
}

export function assignableClanRoles(
  actor: ClanRole,
  titleName?: string | null
): ClanRole[] {
  if (actor === "LEADER") return LEADER_ASSIGNABLE;
  if (actor === "DEPUTY") return DEPUTY_ASSIGNABLE;
  if (isHrTitle(titleName)) return DEPUTY_ASSIGNABLE;
  return [];
}

export function canManageClanMembers(role: ClanRole): boolean {
  return role === "LEADER" || role === "DEPUTY";
}

/** Глава, зам или HR — приглашать в клан */
export function canInviteClanMembers(
  role: ClanRole,
  titleName?: string | null
): boolean {
  if (role === "LEADER" || role === "DEPUTY") return true;
  return isHrTitle(titleName);
}

/** Глава, зам или HR — менять роли в списке игроков */
export function canAssignClanMemberRoles(
  role: ClanRole,
  titleName?: string | null
): boolean {
  return assignableClanRoles(role, titleName).length > 0;
}

export function canAssignClanRole(
  actor: ClanRole,
  targetRole: ClanRole,
  titleName?: string | null
): boolean {
  return assignableClanRoles(actor, titleName).includes(targetRole);
}

/** Сменить роль: зам/главу трогает только глава; HR как зам */
export function canChangeClanMemberRole(
  actor: ClanRole,
  targetCurrent: ClanRole,
  newRole: ClanRole,
  titleName?: string | null
): boolean {
  if (targetCurrent === "LEADER") return false;
  if (actor === "LEADER") {
    return LEADER_ASSIGNABLE.includes(newRole);
  }
  if (actor === "DEPUTY" || isHrTitle(titleName)) {
    if (targetCurrent === "DEPUTY" || newRole === "DEPUTY") return false;
    return DEPUTY_ASSIGNABLE.includes(newRole);
  }
  return false;
}

/** Кик: HR как зам — нельзя кикнуть главу и зама */
export function canKickClanMember(
  actor: ClanRole,
  target: ClanRole,
  titleName?: string | null
): boolean {
  if (target === "LEADER") return false;
  if (target === "DEPUTY") return actor === "LEADER";
  if (actor === "LEADER" || actor === "DEPUTY") return true;
  return isHrTitle(titleName);
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
