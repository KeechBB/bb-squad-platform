#!/usr/bin/env node
/**
 * Upsert CanonMatch + CanonMatchPlayer from JSON payload (written by import_canon_from_kv_cache.py).
 * Usage: node scripts/import_canon_apply.mjs scripts/.canon_import_payload.json
 */
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const path = process.argv[2];
if (!path) {
  console.error("usage: node import_canon_apply.mjs <payload.json>");
  process.exit(1);
}

const rows = JSON.parse(readFileSync(path, "utf8"));
let matches = 0;
let players = 0;

for (const row of rows) {
  const { players: pl = [], ...match } = row;
  const data = {
    matchKey: match.matchKey,
    kind: match.kind,
    source: match.source,
    legacyId: match.legacyId ?? null,
    year: match.year,
    month: match.month,
    day: match.day,
    timeMsk: match.timeMsk ?? null,
    serverKey: match.serverKey ?? null,
    serverLabel: match.serverLabel ?? null,
    mapName: match.mapName,
    mode: match.mode ?? null,
    size: match.size ?? null,
    durationSec: match.durationSec ?? null,
    factionA: match.factionA ?? null,
    ticketsA: match.ticketsA ?? null,
    factionB: match.factionB ?? null,
    ticketsB: match.ticketsB ?? null,
    winner: match.winner ?? null,
    opp: match.opp ?? null,
    stack: match.stack ?? null,
    rules: match.rules ?? null,
    meeting: match.meeting ?? null,
    r1: match.r1 ?? null,
    r2: match.r2 ?? null,
    status: match.status ?? null,
    note: match.note ?? null,
    legacyPlayersPath: match.legacyPlayersPath ?? null,
    rawJson: match.rawJson ?? undefined,
  };

  const existing = await prisma.canonMatch.findUnique({
    where: { matchKey: data.matchKey },
  });

  let matchId;
  if (existing) {
    await prisma.canonMatchPlayer.deleteMany({ where: { matchId: existing.id } });
    const updated = await prisma.canonMatch.update({
      where: { id: existing.id },
      data,
    });
    matchId = updated.id;
  } else {
    // Also try legacy unique
    const byLegacy =
      data.legacyId != null
        ? await prisma.canonMatch.findUnique({
            where: {
              kind_year_month_legacyId: {
                kind: data.kind,
                year: data.year,
                month: data.month,
                legacyId: data.legacyId,
              },
            },
          })
        : null;
    if (byLegacy) {
      await prisma.canonMatchPlayer.deleteMany({ where: { matchId: byLegacy.id } });
      const updated = await prisma.canonMatch.update({
        where: { id: byLegacy.id },
        data,
      });
      matchId = updated.id;
    } else {
      const created = await prisma.canonMatch.create({ data });
      matchId = created.id;
    }
  }
  matches += 1;

  // Dedupe (matchId, nick, round, side) — keep higher kills row
  const byKey = new Map();
  for (const p of pl) {
    const side = p.side ?? "";
    const round = p.round ?? 0;
    const key = `${p.nick}\0${round}\0${side}`;
    const prev = byKey.get(key);
    if (!prev || (p.kills ?? 0) > (prev.kills ?? 0)) byKey.set(key, p);
  }
  for (const p of byKey.values()) {
    await prisma.canonMatchPlayer.create({
      data: {
        matchId,
        side: p.side ?? null,
        round: p.round ?? null,
        nick: p.nick,
        kills: p.kills ?? 0,
        deaths: p.deaths ?? 0,
        nok: p.nok ?? 0,
        res: p.res ?? 0,
        dmg: p.dmg ?? null,
        vehicleKills: p.vehicleKills ?? null,
        won: typeof p.won === "boolean" ? p.won : null,
        rawJson: p.rawJson ?? undefined,
      },
    });
    players += 1;
  }
}

console.log(JSON.stringify({ ok: true, matches, players }));
await prisma.$disconnect();
