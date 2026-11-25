#!/usr/bin/env node
/**
 * Verify cached PB1 player-card stats vs fresh rebuild.
 * Usage: node scripts/verify_panelka_pb1_stats.cjs [--sample 15]
 */
const fs = require("fs");
const path = require("path");
const { PrismaClient } = require("@prisma/client");

const ROOT = process.cwd();
const CACHE_DIR = path.join(ROOT, "data", "cache", "panelka-pb1-stats");
const p = new PrismaClient();
const PB1 = ["TPUB1", "PB1", "TPUB", "PUBLIC"];

function sampleN() {
  const i = process.argv.indexOf("--sample");
  if (i >= 0 && process.argv[i + 1]) return Math.max(1, Number(process.argv[i + 1]) || 12);
  return 12;
}

function listIds(limit) {
  if (!fs.existsSync(CACHE_DIR)) return [];
  return fs
    .readdirSync(CACHE_DIR)
    .filter((f) => /^7656\d{13}\.json$/.test(f))
    .slice(0, limit)
    .map((f) => f.replace(/\.json$/, ""));
}

async function lifeMinutes(steamId) {
  const rows = await p.squadServerSession.findMany({
    where: { steamId, serverKey: { in: PB1 } },
    select: { joinedAt: true, leftAt: true },
    take: 12000,
  });
  let mins = 0;
  const now = Date.now();
  for (const s of rows) {
    const a = s.joinedAt.getTime();
    const b = s.leftAt ? s.leftAt.getTime() : Math.max(now, a);
    if (b > a) mins += (b - a) / 60000;
  }
  return { minutes: Math.round(mins), sessions: rows.length };
}

async function main() {
  const n = sampleN();
  const ids = listIds(800);
  if (!ids.length) {
    console.log(JSON.stringify({ ok: false, error: "cache empty — run warm cron first" }, null, 2));
    process.exit(2);
  }
  const step = Math.max(1, Math.floor(ids.length / n));
  const pick = ids.filter((_, i) => i % step === 0).slice(0, n);
  const mismatches = [];
  for (const steamId of pick) {
    const raw = JSON.parse(
      fs.readFileSync(path.join(CACHE_DIR, `${steamId}.json`), "utf8")
    );
    const life = await lifeMinutes(steamId);
    const cachedMin = Number(raw?.stats?.publicMinutes) || 0;
    const cachedSes = Number(raw?.stats?.sessions) || 0;
    const tol = Math.max(5, Math.round(cachedMin * 0.03));
    if (Math.abs(cachedMin - life.minutes) > tol) {
      mismatches.push({
        steamId,
        field: "publicMinutes",
        cached: cachedMin,
        fresh: life.minutes,
      });
    }
    if (Math.abs(cachedSes - life.sessions) > 2) {
      mismatches.push({
        steamId,
        field: "sessions",
        cached: cachedSes,
        fresh: life.sessions,
      });
    }
  }
  const report = {
    ok: mismatches.length === 0,
    cacheFiles: ids.length,
    checked: pick.length,
    mismatches,
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
