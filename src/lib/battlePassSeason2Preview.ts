/**
 * Server-only: имитация рейтинга Season 2 для halloween-preview.
 * Не трогает живой BP / инвентарь / награды.
 */
import "server-only";

import type { BpPlayerProgress } from "@/lib/battlePass";
import { sortBattlePassRows } from "@/lib/battlePassData";
import { BP_S2_LEVELS } from "@/lib/battlePassSeason2";

function previewSeed(nick: string): number {
  let h = 2166136261;
  const s = String(nick || "").trim().toLowerCase();
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

function mockProgressForNick(
  nick: string,
  placeHint: number
): BpPlayerProgress {
  const seed = previewSeed(nick);
  const placeBoost = Math.max(0, 1 - placeHint / 55);
  const mix = Math.min(0.98, seed * 0.35 + placeBoost * 0.72);
  const maxLv = BP_S2_LEVELS.length;
  const currentLevel = Math.max(
    1,
    Math.min(maxLv, Math.floor(mix * maxLv) + 1)
  );
  const L = BP_S2_LEVELS[currentLevel - 1] || BP_S2_LEVELS[0];
  const current = Math.min(
    L.target - (currentLevel >= maxLv ? 0 : 1),
    Math.max(0, Math.floor(seed * L.target * 0.85))
  );
  return {
    nick,
    currentLevel,
    current,
    target: L.target,
  };
}

/** Реальные ники + фейковые уровни. Только для Keech-превью. */
export async function buildSeason2PreviewMockLeaderboard(opts?: {
  selfNick?: string;
  cap?: number;
}): Promise<{ board: BpPlayerProgress[]; self: BpPlayerProgress }> {
  const cap = Math.max(10, Math.min(50, opts?.cap ?? 50));
  const selfNick = String(opts?.selfNick || "").trim();

  let nicks: string[] = [];
  try {
    const { buildTrainRpLeaderboard } = await import("@/lib/trainRp");
    const board = await buildTrainRpLeaderboard();
    nicks = (board.rows || [])
      .map((r) => String(r.nick || "").trim())
      .filter(Boolean);
  } catch {
    nicks = [];
  }

  if (nicks.length < 12) {
    try {
      const { prisma } = await import("@/lib/prisma");
      const users = await prisma.user.findMany({
        where: { profileComplete: true, nick: { not: null } },
        select: { nick: true },
        take: 80,
        orderBy: { createdAt: "asc" },
      });
      for (const u of users) {
        const n = String(u.nick || "").trim();
        if (n && !nicks.includes(n)) nicks.push(n);
      }
    } catch {
      /* ignore */
    }
  }

  if (
    selfNick &&
    !nicks.some((n) => n.toLowerCase() === selfNick.toLowerCase())
  ) {
    nicks.unshift(selfNick);
  }

  const rows = nicks
    .slice(0, cap)
    .map((nick, i) => mockProgressForNick(nick, i + 1));
  const board = sortBattlePassRows(rows);
  const self =
    board.find(
      (r) =>
        selfNick &&
        r.nick.trim().toLowerCase() === selfNick.toLowerCase()
    ) ||
    (selfNick
      ? mockProgressForNick(selfNick, 8)
      : mockProgressForNick("Keech", 8));

  return { board, self };
}
