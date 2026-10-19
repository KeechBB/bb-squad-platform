import { BP_REWARDS, type BpReward, type BpRewardKind } from "@/lib/battlePass";
import {
  loadBattlePassState,
  progressForNick,
} from "@/lib/battlePassData";

export type ProfileMedalItem = {
  id: string;
  name: string;
  short: string;
  kind: BpRewardKind;
  level: number;
  hover: string;
  icon: string;
  source: "bp";
};

const BP_ICONS: Record<string, string> = {
  "pb1-scout-spark": "/bp-previews/l5-iskra.png",
  "pb1-iron-frame": "/bp-previews/l10-bronelist.png",
  "pb1-gold-nick": "/bp-previews/l15-gold-nick.png",
  "pb1-best-tester": "/bp-previews/l20-medal.png",
};

function iconFor(r: BpReward): string {
  return BP_ICONS[r.id] || "/bp-previews/l20-medal.png";
}

/** Награды BP, которые игрок уже открыл (ур. достигнут или сезон закрыт). */
export async function buildPlayerMedalShelf(
  nick: string
): Promise<ProfileMedalItem[]> {
  const clean = String(nick || "").trim();
  if (!clean) return [];
  const state = await loadBattlePassState().catch(() => null);
  const prog = progressForNick(state, clean);
  const unlocked = (r: BpReward) =>
    Boolean(prog.completedAt) || prog.currentLevel >= r.level;

  return BP_REWARDS.filter(unlocked).map((r) => ({
    id: r.id,
    name: r.name,
    short: r.short,
    kind: r.kind,
    level: r.level,
    hover: r.hover || r.preview || r.name,
    icon: iconFor(r),
    source: "bp" as const,
  }));
}
