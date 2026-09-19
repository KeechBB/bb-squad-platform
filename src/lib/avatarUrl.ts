/** Client-safe avatar URL helpers (no Node fs). */

/** Old links /uploads/avatars/... → /api/avatars/... */
export function resolveAvatarSrc(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith("/uploads/avatars/")) {
    return url.replace("/uploads/avatars/", "/api/avatars/");
  }
  return url;
}

/** Сброс кэша браузера: один и тот же файл после замены иначе «залипает» */
export function withAvatarCacheBust(
  url: string | null | undefined,
  version: number | string | Date | null | undefined
): string | null {
  const resolved = resolveAvatarSrc(url);
  if (!resolved) return null;
  if (/^https?:\/\//i.test(resolved)) return resolved;
  const v =
    version instanceof Date
      ? version.getTime()
      : version != null && version !== ""
        ? String(version)
        : Date.now();
  const base = resolved.split("?")[0];
  return `${base}?v=${v}`;
}
