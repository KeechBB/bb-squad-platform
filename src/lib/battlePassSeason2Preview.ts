/**
 * Server-only (импортировать только из RSC / route):
 * превью рейтинга Season 2 для halloween-preview.
 * Не трогает живой BP / инвентарь / награды.
 */

import type { BpPlayerProgress } from "@/lib/battlePass";
import { BP_S2_LEVELS } from "@/lib/battlePassSeason2";

function emptyProgress(nick: string): BpPlayerProgress {
  const L1 = BP_S2_LEVELS[0];
  return {
    nick: String(nick || "Keech").trim() || "Keech",
    currentLevel: 1,
    current: 0,
    target: L1.target,
    nickPatch: null,
    nickStyle: null,
  };
}

/**
 * Пустая доска (тот же размер в UI — 10 слотов × 5 страниц).
 * Косметика нашивок/шрифтов подтягивается, когда появятся реальные строки.
 */
export async function buildSeason2PreviewMockLeaderboard(opts?: {
  selfNick?: string;
  cap?: number;
}): Promise<{ board: BpPlayerProgress[]; self: BpPlayerProgress }> {
  const selfNick = String(opts?.selfNick || "").trim() || "Keech";
  void opts?.cap;
  return {
    board: [],
    self: emptyProgress(selfNick),
  };
}
