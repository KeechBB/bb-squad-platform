#!/usr/bin/env node
/**
 * Post-grant / health check for panelka cfg:
 *   - active DB VIPs → Admins.cfg QueuePriority
 *   - PUBLIC_ADMIN / PUBLIC_MOD → forever QueuePriority
 *   - focused ban → Bans.cfg
 *   - focused camera → Cameraman / bb-cameras
 *
 * Usage:
 *   node scripts/verify_panelka_cfgs.cjs
 *   node scripts/verify_panelka_cfgs.cjs --kind vip --steam 7656…
 *   node scripts/verify_panelka_cfgs.cjs --kind ban --steam 7656…
 *   node scripts/verify_panelka_cfgs.cjs --kind camera --steam 7656…
 *   node scripts/verify_panelka_cfgs.cjs --kind all
 */
const { PrismaClient } = require("@prisma/client");
const { spawnSync } = require("child_process");
const path = require("path");

const ROOT = process.cwd();
const p = new PrismaClient();
const py = path.join(ROOT, "scripts", ".venv-collector", "bin", "python");
const script = path.join(ROOT, "scripts", "panelka_rcon.py");
const STEAM_RE = /^7656\d{13}$/;
const STAFF_ROLES = ["PUBLIC_ADMIN", "PUBLIC_MOD"];

function argsOf() {
  const out = { kind: "all", steam: "" };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--kind" && argv[i + 1]) out.kind = argv[++i];
    else if (argv[i] === "--steam" && argv[i + 1]) out.steam = argv[++i];
    else if (STEAM_RE.test(argv[i])) out.steam = argv[i];
  }
  if (!["vip", "ban", "camera", "all"].includes(out.kind)) out.kind = "all";
  return out;
}

function run(cmdArgs, extra) {
  const env = { ...process.env };
  if (extra) env.PANELKA_JSON = JSON.stringify(extra);
  const r = spawnSync(py, [script, ...cmdArgs], {
    cwd: ROOT,
    env,
    encoding: "utf8",
    timeout: 90000,
  });
  const text = (r.stdout || "").trim();
  const lines = text.split(/\r?\n/).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].startsWith("{")) continue;
    try {
      return JSON.parse(lines[i]);
    } catch {
      /* continue */
    }
  }
  throw new Error((text || r.stderr || "empty").slice(0, 500));
}

async function main() {
  const { kind, steam } = argsOf();
  const focus = STEAM_RE.test(steam) ? steam : "";
  const errors = [];

  const vipList = run(["vips-list"]);
  if (!vipList.ok) throw new Error(vipList.error || "vips-list fail");
  const vipIds = new Set((vipList.vips || []).map((v) => v.steamId).filter(Boolean));

  const dbActive = await p.panelkaVipGrant.findMany({
    where: { active: true },
    select: { steamId: true, nick: true, forever: true, note: true },
  });
  const missingVip = dbActive.filter((r) => !vipIds.has(r.steamId));

  const staff = await p.user.findMany({
    where: { role: { in: STAFF_ROLES } },
    select: { steamId: true, nick: true, steamName: true, role: true },
  });
  const staffMissing = staff.filter((u) => !vipIds.has(u.steamId));
  const staffNotForever = [];
  for (const u of staff) {
    if (!vipIds.has(u.steamId)) continue;
    const db = dbActive.find((r) => r.steamId === u.steamId);
    const cfg = (vipList.vips || []).find((v) => v.steamId === u.steamId);
    const forever =
      (db && db.forever) ||
      (cfg && String(cfg.until || "") === "forever") ||
      /навсегда|forever/i.test((cfg && cfg.comment) || "");
    if (!forever) staffNotForever.push(u);
  }

  let banFocus = null;
  let camFocus = null;
  let camCount = 0;

  if (kind === "vip" || kind === "all") {
    if (focus && !vipIds.has(focus)) {
      errors.push(`focus ${focus} missing QueuePriority in Admins.cfg`);
    }
    if (!focus) {
      if (missingVip.length) {
        errors.push(`DB VIP missing from cfg: ${missingVip.length}`);
      }
      if (staffMissing.length) {
        errors.push(`PUBLIC_ADMIN/MOD missing QueuePriority: ${staffMissing.length}`);
      }
      if (staffNotForever.length) {
        errors.push(`staff VIP not forever: ${staffNotForever.length}`);
      }
    }
  }

  if (kind === "ban" || kind === "all") {
    if (focus) {
      const bans = run(["bans-list"]);
      if (!bans.ok) throw new Error(bans.error || "bans-list fail");
      banFocus = (bans.bans || []).some(
        (b) => b.steamId === focus || b.id === focus
      );
      if (!banFocus) errors.push(`focus ${focus} missing from Bans.cfg`);
    }
  }

  if (kind === "camera" || kind === "all") {
    const cams = run(["cameras-list"]);
    if (!cams.ok) throw new Error(cams.error || "cameras-list fail");
    camCount = cams.count || (cams.cameras || []).length;
    if (focus) {
      camFocus = (cams.cameras || []).some((c) => c.steamId === focus);
      if (kind === "camera" && !camFocus) {
        errors.push(`focus ${focus} missing Cameraman in Admins.cfg`);
      }
    }
  }

  const report = {
    ok: errors.length === 0,
    kind,
    focus: focus || null,
    errors,
    vip: {
      cfgCount: vipIds.size,
      dbActive: dbActive.length,
      missingFromCfg: missingVip.map((r) => ({
        steamId: r.steamId,
        nick: r.nick,
      })),
      staffTotal: staff.length,
      staffMissing: staffMissing.map((u) => ({
        steamId: u.steamId,
        nick: u.nick || u.steamName,
        role: u.role,
      })),
      staffNotForever: staffNotForever.map((u) => ({
        steamId: u.steamId,
        nick: u.nick || u.steamName,
        role: u.role,
      })),
      focusInCfg: focus ? vipIds.has(focus) : null,
    },
    ban: { focusInCfg: banFocus },
    camera: { cfgCount: camCount, focusInCfg: camFocus },
    checkedAt: new Date().toISOString(),
  };

  console.log(JSON.stringify(report, null, 2));
  await p.$disconnect();
  if (!report.ok) process.exit(2);
}

main().catch(async (e) => {
  console.error(String(e && e.stack ? e.stack : e));
  await p.$disconnect();
  process.exit(1);
});
