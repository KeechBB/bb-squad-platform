/** Безопасный адрес картинки в письме. Без data:, javascript: и чужих путей. */
export function safeMailImgSrc(raw: string): string | null {
  const s = raw.trim();
  if (/^\/api\/mail\/image\/[a-f0-9]{24}\.(png|jpg|webp|gif)$/i.test(s)) return s;
  if (s.length > 500 || !/^https:\/\//i.test(s)) return null;
  try {
    const url = new URL(s);
    if (url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function isBareImageUrl(raw: string): boolean {
  return /\.(png|jpe?g|webp|gif)(\?.*)?$/i.test(raw.trim());
}
