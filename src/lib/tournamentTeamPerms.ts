import type { TournamentTeamRole as DbRole } from "@prisma/client";

export type ActorCtx = {
  userId: string;
  role: DbRole;
};

export function canManageTeam(actor: ActorCtx): boolean {
  return actor.role === "CAPTAIN" || actor.role === "DEPUTY";
}

export function canDeleteTeam(actor: ActorCtx): boolean {
  return actor.role === "CAPTAIN";
}

export function canChangeLogo(actor: ActorCtx): boolean {
  return actor.role === "CAPTAIN" || actor.role === "DEPUTY";
}

export function canInvite(actor: ActorCtx): boolean {
  return actor.role === "CAPTAIN" || actor.role === "DEPUTY";
}

export function canRegisterTournament(actor: ActorCtx): boolean {
  return actor.role === "CAPTAIN" || actor.role === "DEPUTY";
}

/** Какие роли актёр может выдать цели. */
export function allowedTargetRoles(
  actor: ActorCtx,
  targetRole: DbRole,
  targetUserId: string
): DbRole[] | null {
  if (actor.role === "CAPTAIN") {
    return ["CAPTAIN", "DEPUTY", "STARTER", "SUB", "RESERVE"];
  }
  if (actor.role === "DEPUTY") {
    // Ничего с капитаном; не выдаёт CAPTAIN/DEPUTY
    if (targetRole === "CAPTAIN") return null;
    if (targetUserId === actor.userId) {
      // себя — только в основной/замену/резерв (снять с зама может только капитан)
      return null;
    }
    if (targetRole === "DEPUTY") return null;
    return ["STARTER", "SUB", "RESERVE"];
  }
  return null;
}
