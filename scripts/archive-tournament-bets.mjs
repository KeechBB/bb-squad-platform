/** One-shot: rebuild fruit-strike bets archive on plaza disk. */
import { pathToFileURL } from "url";
import path from "path";

const root = process.cwd();
// Prefer compiled path via tsx
const mod = await import(
  pathToFileURL(path.join(root, "src/lib/tournamentBetArchive.ts")).href
);
const archive = await mod.rebuildTournamentBetArchive();
console.log(
  JSON.stringify(
    {
      file: mod.tournamentBetArchiveRelPath(),
      betsCount: archive.betsCount,
      exportedAt: archive.exportedAt,
      tallies: archive.tallies,
    },
    null,
    2
  )
);
