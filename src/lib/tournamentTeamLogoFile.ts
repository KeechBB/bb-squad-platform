import { mkdir, writeFile, unlink, readdir } from "fs/promises";
import path from "path";
import {
  detectClanLogoMime,
  type ClanLogoMime,
  CLAN_LOGO_MAX,
} from "@/lib/clanLogoFile";

export const TEAM_LOGO_DIR = path.join(process.cwd(), "storage", "tournament-teams");
export const TEAM_LOGO_MAX = CLAN_LOGO_MAX;
export { detectClanLogoMime };
export type TeamLogoMime = ClanLogoMime;

const TYPES = {
  "image/png": "png",
  "image/webp": "webp",
} as const;

async function clearTeamLogoFiles(teamId: string) {
  try {
    const files = await readdir(TEAM_LOGO_DIR);
    await Promise.all(
      files
        .filter((f) => f.startsWith(`${teamId}.`))
        .map((f) => unlink(path.join(TEAM_LOGO_DIR, f)).catch(() => undefined))
    );
  } catch {
    /* empty */
  }
}

export async function saveTeamLogo(
  teamId: string,
  buf: Buffer,
  mime: TeamLogoMime
) {
  await mkdir(TEAM_LOGO_DIR, { recursive: true });
  await clearTeamLogoFiles(teamId);
  const ext = TYPES[mime];
  const filePath = path.join(TEAM_LOGO_DIR, `${teamId}.${ext}`);
  await writeFile(filePath, buf);
  return `/api/tournaments/teams/logo/${teamId}.${ext}?v=${Date.now()}`;
}

export async function deleteTeamLogo(teamId: string) {
  await clearTeamLogoFiles(teamId);
}
