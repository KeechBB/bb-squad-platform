/**
 * Короткие даты для UI: всегда день.месяц (RU), не месяц.день.
 * `2026-11-17` → `17.11`
 */

/** YYYY-MM-DD → DD.MM. Уже короткий/другой формат — как есть. */
export function formatYmdShort(ymd: string | null | undefined): string {
  const s = String(ymd || "").trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[3]}.${m[2]}`;
  return s;
}

/** YYYY-MM-DD → DD.MM.YYYY */
export function formatYmdRu(ymd: string | null | undefined): string {
  const s = String(ymd || "").trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[3]}.${m[2]}.${m[1]}`;
  return s;
}
