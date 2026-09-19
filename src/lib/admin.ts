/** Главный админ — Keech. Доп. ID через ADMIN_STEAM_IDS=id1,id2 в .env */
const BUILTIN_ADMIN_STEAM_IDS = ["76561198028435874"] as const;

export function getAdminSteamIds(): Set<string> {
  const fromEnv = (process.env.ADMIN_STEAM_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return new Set([...BUILTIN_ADMIN_STEAM_IDS, ...fromEnv]);
}

export function isAdminSteamId(steamId: string | null | undefined): boolean {
  if (!steamId) return false;
  return getAdminSteamIds().has(steamId);
}

export function isValidSteamId(steamId: string): boolean {
  return /^[0-9]{15,20}$/.test(steamId.trim());
}
