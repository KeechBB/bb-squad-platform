import { PrismaClient } from "@prisma/client";
import { rebuildProfileViewFile } from "../src/lib/profileViewSnapshot";
import { buildPlayerTrainMatchHistory } from "../src/lib/homeTrainPwr";

const SANYA = "76561198941350361";

async function main() {
  const p = new PrismaClient();
  try {
    const u = await p.user.findFirst({ where: { steamId: SANYA } });
    if (!u) throw new Error("no angel bb user");
    console.log("user", u.nick, u.steamId);
    const hist = await buildPlayerTrainMatchHistory(u.nick, {
      steamId: u.steamId,
    });
    const after18 = hist.filter((r) => {
      const raw = String(r.dateLabel || "");
      // 19.11.2026 / 2026-11-19
      if (/2026-11-(1[9]|2\d)/.test(raw)) return true;
      const m = raw.match(/(\d{2})\.11\.2026/);
      return m ? Number(m[1]) >= 19 : false;
    });
    console.log(
      "hist_total",
      hist.length,
      "after18",
      after18.length,
      "latest",
      hist.slice(0, 8).map((r) => `${r.dateLabel} ${r.mapLabel || r.map || ""}`)
    );
    const data = await rebuildProfileViewFile(u.id, u.nick);
    const th = (data as { trainHistory?: unknown[] })?.trainHistory || [];
    console.log("profile_trainHistory", th.length);
  } finally {
    await p.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
