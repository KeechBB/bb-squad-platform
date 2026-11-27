/** Фон фракции для страницы менеджмента (файлы в /public/profile-bgs/). */

const FACTION_BG_BY_SLUG: Record<string, string> = {
  улей: "bd-faction-uley-bg-v5.jpg",
  орда: "bd-faction-orda-bg-v6.jpg",
  стая: "bd-faction-staya-bg-v8.jpg",
  легион: "bd-faction-legion-bg-v5.jpg",
  сброд: "bd-faction-sbord-bg-v5.jpg",
  табор: "bd-faction-tabor-bg-v5.jpg",
};

export function factionMgmtBgUrl(slug: string): string | null {
  const key = slug.trim().toLowerCase();
  const file = FACTION_BG_BY_SLUG[key];
  if (!file) return null;
  return `/profile-bgs/${file}`;
}

export function factionMgmtPath(slug: string): string {
  return `/factions/${encodeURIComponent(slug)}/менеджмент`;
}
