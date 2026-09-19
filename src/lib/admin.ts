import { prisma } from "@/lib/prisma";
import {
  assignableRoles,
  parseRole,
  type AppRole,
} from "@/lib/roles";

export type { AppRole } from "@/lib/roles";
export { roleLabel, parseRole, assignableRoles } from "@/lib/roles";

/** Главный админ — Keech */
const BUILTIN_SUPER_ADMIN_STEAM_IDS = ["76561198028435874"] as const;

/** Заместитель — полный доступ к ролям, кроме главного админа */
const BUILTIN_DEPUTY_STEAM_IDS = ["76561198219388005"] as const;

export function getBuiltinSuperAdminIds(): Set<string> {
  const fromEnv = (process.env.ADMIN_STEAM_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return new Set([...BUILTIN_SUPER_ADMIN_STEAM_IDS, ...fromEnv]);
}

export function getBuiltinDeputyIds(): Set<string> {
  const fromEnv = (process.env.DEPUTY_STEAM_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return new Set([...BUILTIN_DEPUTY_STEAM_IDS, ...fromEnv]);
}

export function isBuiltinSuperAdmin(steamId: string | null | undefined): boolean {
  if (!steamId) return false;
  return getBuiltinSuperAdminIds().has(steamId);
}

export function isBuiltinDeputy(steamId: string | null | undefined): boolean {
  if (!steamId) return false;
  return getBuiltinDeputyIds().has(steamId);
}

export function effectiveRole(steamId: string, role: AppRole): AppRole {
  if (isBuiltinSuperAdmin(steamId)) return "SUPER_ADMIN";
  if (isBuiltinDeputy(steamId)) return "DEPUTY";
  return role;
}

export async function getUserRole(steamId: string): Promise<AppRole | null> {
  if (isBuiltinSuperAdmin(steamId)) return "SUPER_ADMIN";
  if (isBuiltinDeputy(steamId)) return "DEPUTY";
  const u = await prisma.user.findUnique({
    where: { steamId },
    select: { role: true },
  });
  if (!u) return null;
  return effectiveRole(steamId, u.role as AppRole);
}

/** Доступ в админку */
export async function isAdmin(steamId: string | null | undefined): Promise<boolean> {
  if (!steamId) return false;
  const role = await getUserRole(steamId);
  return (
    role === "ADMIN" ||
    role === "HR" ||
    role === "DEPUTY" ||
    role === "SUPER_ADMIN"
  );
}

export async function isSuperAdmin(steamId: string | null | undefined): Promise<boolean> {
  if (!steamId) return false;
  return (await getUserRole(steamId)) === "SUPER_ADMIN";
}

export async function isDeputyOrAbove(steamId: string | null | undefined): Promise<boolean> {
  if (!steamId) return false;
  const role = await getUserRole(steamId);
  return role === "DEPUTY" || role === "SUPER_ADMIN";
}

export function isValidSteamId(steamId: string): boolean {
  return /^[0-9]{15,20}$/.test(steamId.trim());
}

export async function syncBuiltinAdmins() {
  const supers = [...getBuiltinSuperAdminIds()];
  const deputies = [...getBuiltinDeputyIds()];
  if (supers.length) {
    await prisma.user.updateMany({
      where: { steamId: { in: supers } },
      data: { role: "SUPER_ADMIN" },
    });
  }
  if (deputies.length) {
    await prisma.user.updateMany({
      where: { steamId: { in: deputies } },
      data: { role: "DEPUTY" },
    });
  }
}

/**
 * Можно ли править анкету / аватар цели.
 * HR — все, кроме Зама и Главного админа.
 */
export function canEditProfile(
  actorRole: AppRole,
  targetRole: AppRole,
  targetSteamId: string
): boolean {
  if (isBuiltinSuperAdmin(targetSteamId) || targetRole === "SUPER_ADMIN") {
    return false;
  }
  if (actorRole === "SUPER_ADMIN" || actorRole === "DEPUTY") {
    return true;
  }
  if (actorRole === "HR") {
    return targetRole !== "DEPUTY";
  }
  if (actorRole === "ADMIN") {
    return targetRole === "USER";
  }
  return false;
}

/**
 * Можно ли актору менять роль цели.
 * - Главный / Зам: все, кроме главного админа
 * - HR: все, кроме Зама и главного
 * - Админ: только игроки (USER)
 */
export function canChangeRole(
  actorRole: AppRole,
  targetRole: AppRole,
  targetSteamId: string
): boolean {
  return canEditProfile(actorRole, targetRole, targetSteamId);
}

export function canSetRole(
  actorRole: AppRole,
  targetRole: AppRole,
  targetSteamId: string,
  newRole: AppRole
): boolean {
  if (!canChangeRole(actorRole, targetRole, targetSteamId)) return false;
  if (newRole === "SUPER_ADMIN") return false;
  if (!assignableRoles(actorRole).includes(newRole)) return false;
  if (actorRole === "ADMIN" && targetRole !== "USER") return false;
  if (actorRole === "HR" && (newRole === "DEPUTY" || targetRole === "DEPUTY")) {
    return false;
  }
  return true;
}
