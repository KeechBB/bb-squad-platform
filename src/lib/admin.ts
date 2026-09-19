import { prisma } from "@/lib/prisma";

/** Главный админ — Keech. Доп. через ADMIN_STEAM_IDS в .env */
const BUILTIN_ADMIN_STEAM_IDS = ["76561198028435874"] as const;

export type AppRole = "USER" | "ADMIN";

export function getAdminSteamIds(): Set<string> {
  const fromEnv = (process.env.ADMIN_STEAM_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return new Set([...BUILTIN_ADMIN_STEAM_IDS, ...fromEnv]);
}

export function isBuiltinAdmin(steamId: string | null | undefined): boolean {
  if (!steamId) return false;
  return getAdminSteamIds().has(steamId);
}

/** Админ: вшитый Steam ID или role=ADMIN в БД */
export async function isAdmin(steamId: string | null | undefined): Promise<boolean> {
  if (!steamId) return false;
  if (isBuiltinAdmin(steamId)) return true;
  const u = await prisma.user.findUnique({
    where: { steamId },
    select: { role: true },
  });
  return u?.role === "ADMIN";
}

export function effectiveRole(steamId: string, role: AppRole): AppRole {
  if (isBuiltinAdmin(steamId)) return "ADMIN";
  return role;
}

export function roleLabel(role: AppRole): string {
  return role === "ADMIN" ? "Админ" : "Игрок";
}

export function isValidSteamId(steamId: string): boolean {
  return /^[0-9]{15,20}$/.test(steamId.trim());
}

/** Подтянуть role=ADMIN у вшитых Steam ID */
export async function syncBuiltinAdmins() {
  const ids = [...getAdminSteamIds()];
  if (!ids.length) return;
  await prisma.user.updateMany({
    where: { steamId: { in: ids } },
    data: { role: "ADMIN" },
  });
}
