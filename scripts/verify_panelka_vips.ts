#!/usr/bin/env npx tsx
/**
 * Сверка всех VIP (QueuePriority):
 *  - active grants в БД ↔ Admins.cfg
 *  - группа QueuePriority реально даёт reserve (приоритет очереди)
 *  - лишние строки в cfg без активной выдачи (инфо)
 *
 * Usage:
 *   cd /var/www/bb-squad-platform && npx tsx scripts/verify_panelka_vips.ts
 *   npx tsx scripts/verify_panelka_vips.ts --heal   # дописать missing из БД в cfg
 */
import { prisma } from "../src/lib/prisma";
import { runPanelka } from "../src/lib/panelkaRcon";
import { verifyPanelkaCfgs } from "../src/lib/panelkaCfgVerify";
import { vipClanTags } from "../src/lib/clanActor";
import { grantPublicVip } from "../src/lib/panelkaVipBan";

const STEAM_RE = /^7656\d{13}$/;

type CfgVip = {
  steamId: string;
  forever?: boolean;
  until?: string;
  byNick?: string;
  note?: string;
  line?: string;
};

async function main() {
  const heal = process.argv.includes("--heal");
  console.log("VIP clans (site grants):", vipClanTags().join(", "));

  const cfg = (await runPanelka(["vips-list"], 30000)) as {
    ok?: boolean;
    vips?: CfgVip[];
    error?: string;
  };
  if (!cfg?.ok) {
    console.error("vips-list fail:", cfg?.error);
    process.exit(2);
  }
  const cfgRows = (cfg.vips || []).filter((v) => STEAM_RE.test(String(v.steamId || "")));
  const cfgSet = new Set(cfgRows.map((v) => v.steamId));

  // Group line permissions
  const groupCheck = (await runPanelka(["vips-heal"], 25000)) as {
    ok?: boolean;
    healed?: number;
    error?: string;
  };
  console.log("heal_bb_vips:", groupCheck);

  const verify = await verifyPanelkaCfgs({ kind: "vip" });
  console.log(
    JSON.stringify(
      {
        ok: verify.ok,
        dbActive: verify.vip.dbActive,
        cfgCount: verify.vip.cfgCount,
        missingFromCfg: verify.vip.missingFromCfg,
        staffMissing: verify.vip.staffMissing,
        error: verify.error || null,
      },
      null,
      2
    )
  );

  const db = await prisma.panelkaVipGrant.findMany({
    where: { active: true },
    select: {
      steamId: true,
      nick: true,
      forever: true,
      endsAt: true,
      byNick: true,
      note: true,
    },
    orderBy: { grantedAt: "desc" },
  });

  const missing = db.filter((g) => !cfgSet.has(g.steamId));
  const orphanCfg = cfgRows.filter(
    (v) => !db.some((g) => g.steamId === v.steamId)
  );

  console.log("--- DB active without cfg ---", missing.length);
  for (const g of missing.slice(0, 40)) {
    console.log(`  ${g.steamId}  ${g.nick || "—"}  by=${g.byNick || "—"}`);
  }
  console.log("--- cfg QueuePriority without active DB ---", orphanCfg.length);
  for (const v of orphanCfg.slice(0, 40)) {
    console.log(`  ${v.steamId}  by=${v.byNick || "—"}  ${v.note || v.line || ""}`.slice(0, 160));
  }

  const sample = cfgRows[0];
  console.log("sample_cfg_vip:", sample || null);
  console.log(
    "queue_priority_note: Group=QueuePriority must include `reserve` (+ balance,teamchange). lines=Admin=SteamID:QueuePriority // …"
  );

  if (heal && missing.length) {
    console.log("--- heal missing ---");
    for (const g of missing) {
      const res = await grantPublicVip({
        steamId: g.steamId,
        nick: g.nick || undefined,
        startsAt: new Date(),
        endsAt: g.forever ? null : g.endsAt,
        forever: Boolean(g.forever),
        byNick: g.byNick || "vip-verify-heal",
        note: g.note || "heal from verify_panelka_vips",
      });
      console.log(g.steamId, res.ok ? "OK" : `FAIL ${"error" in res ? res.error : ""}`);
    }
  }

  const ok =
    verify.ok &&
    missing.length === 0 &&
    verify.vip.staffMissing.length === 0;
  console.log(ok ? "RESULT ok" : "RESULT FAIL");
  process.exit(ok ? 0 : 1);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(2);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
