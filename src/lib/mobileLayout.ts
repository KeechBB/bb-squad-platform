/** Keep in sync with app/mobile.css. Layout depends on width, not input device. */
export const MOBILE_LAYOUT_QUERY = "(max-width: 1023px)";
export function isMobileLayout(): boolean {
  return typeof window !== "undefined" && window.matchMedia(MOBILE_LAYOUT_QUERY).matches;
}
