import { mkdir, writeFile, unlink, readdir } from "fs/promises";
import path from "path";

export const TEAM_LOGO_DIR = path.join(process.cwd(), "storage", "tournament-teams");
/** Турнирные лого — до 20 МБ (клановые отдельно, 5 МБ). */
export const TEAM_LOGO_MAX = 20 * 1024 * 1024;
export const TEAM_LOGO_MAX_MB = 20;

const TYPES = {
  "image/png": "png",
  "image/webp": "webp",
  "image/jpeg": "jpg",
} as const;

export type TeamLogoMime = keyof typeof TYPES;

/** Magic-bytes: png / webp / jpeg (Discord часто отдаёт jpeg под именем .png). */
export function detectClanLogoMime(buf: Buffer): TeamLogoMime | null {
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  ) {
    return "image/png";
  }
  if (
    buf.length >= 12 &&
    buf.toString("ascii", 0, 4) === "RIFF" &&
    buf.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "image/jpeg";
  }
  return null;
}

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
