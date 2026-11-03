/** Канон URL профиля: /players/<steamId>. Ник только для отображения. */

const STEAM_ID_RE = /^765\d{14,17}$/;

export function isSteamIdParam(raw: string | null | undefined): boolean {
  const s = String(raw || "").trim();
  return STEAM_ID_RE.test(s);
}

export function playerPath(steamId: string): string {
  const id = String(steamId || "").trim();
  if (!id) return "/players";
  return `/players/${encodeURIComponent(id)}`;
}

export function playerPathFromUser(user: {
  steamId?: string | null;
  nick?: string | null;
}): string {
  const sid = String(user.steamId || "").trim();
  if (sid) return playerPath(sid);
  const nick = String(user.nick || "").trim();
  return nick ? `/players/${encodeURIComponent(nick)}` : "/players";
}
