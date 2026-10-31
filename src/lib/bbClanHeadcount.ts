/** Ориентир состава, который назвал капитан. Не точный подсчёт. */
export const CLAN_REAL_LO = 300;
export const CLAN_REAL_HI = 310;
export const CLAN_REAL_LABEL = "300–310";

export function clanMissingApprox(onSite: number): string {
  if (!Number.isFinite(onSite) || onSite <= 0) return "—";
  const lo = Math.max(0, CLAN_REAL_LO - onSite);
  const hi = Math.max(0, CLAN_REAL_HI - onSite);
  if (lo === hi) return lo === 0 ? "0" : `~${lo}`;
  return `~${lo}–${hi}`;
}
