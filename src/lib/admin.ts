import { prisma } from "@/lib/prisma";
import type { AppRole } from "@/lib/roles";

export type { AppRole } from "@/lib/roles";
export { roleLabel, parseRole } from "@/lib/roles";

/** Главный админ — Keech. Доп. через ADMIN_STEAM_IDS в .env */
const BUILTIN_SUPER_ADMIN_STEAM_IDS = ["76561198028435874"] as const;

export function getBuiltinSuperAdminIds(): Set<string> {
  const fromEnv = (process.env.ADMIN_STEAM_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return new Set([...BUILTIN_SUPER_ADMIN_STEAM_IDS, ...fromEnv]);
}

export function isBuiltinSuperAdmin(steamId: string | null | undefined): boolean {
  if (!steamId) return false;
  return getBuiltinSuperAdminIds().has(steamId);
}

export function effectiveRole(steamId: string, role: AppRole): AppRole {
  if (isBuiltinSuperAdmin(steamId)) return "SUPER_ADMIN";
  return role;
}

/** Доступ в админку: Админ или Главный админ */
export async function isAdmin(steamId: string | null | undefined): Promise<boolean> {
  if (!steamId) return false;
  if (isBuiltinSuperAdmin(steamId)) return true;
  const u = await prisma.user.findUnique({
    where: { steamId },
    select: { role: true },
  });
  return u?.role === "ADMIN" || u?.role === "SUPER_ADMIN";
}

export async function isSuperAdmin(steamId: string | null | undefined): Promise<boolean> {
  if (!steamId) return false;
  if (isBuiltinSuperAdmin(steamId)) return true;
  const u = await prisma.user.findUnique({
    where: { steamId },
    select: { role: true },
  });
  return u?.role === "SUPER_ADMIN";
}

export function isValidSteamId(steamId: string): boolean {
  return /^[0-9]{15,20}$/.test(steamId.trim());
}

export async function syncBuiltinAdmins() {
  const ids = [...getBuiltinSuperAdminIds()];
  if (!ids.length) return;
  await prisma.user.updateMany({
    where: { steamId: { in: ids } },
    data: { role: "SUPER_ADMIN" },
  });
}

/** Кто может менять роль цели (только главный админ → Игрок/Админ) */
export function canChangeRole(
  actorRole: AppRole,
  targetRole: AppRole,
  targetSteamId: string
): boolean {
  if (actorRole !== "SUPER_ADMIN") return false;
  if (isBuiltinSuperAdmin(targetSteamId)) return false;
  if (targetRole === "SUPER_ADMIN") return false;
  return true;
}
