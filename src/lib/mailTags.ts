export const MAIL_TAG_PRESETS = [
  "Матч",
  "Тактика",
  "Турнир",
  "Тренировка",
  "Трансферы",
  "Вступление",
  "Контракты",
  "Финансы",
] as const;

export const MAIL_TAG_MAX = 3;

/** Палитра меток (класс `.mail-tag.is-*`). */
export const MAIL_TAG_TONES = [
  "slate",
  "blue",
  "orange",
  "teal",
  "purple",
  "green",
  "violet",
] as const;

export type MailTagTone = (typeof MAIL_TAG_TONES)[number];

const NAMED: Record<string, MailTagTone> = {
  матч: "slate",
  тактика: "blue",
  турнир: "purple",
  тренировка: "orange",
  трансферы: "teal",
  вступление: "green",
  контракты: "teal",
  финансы: "violet",
  interactions: "orange",
  кв: "orange",
  junior: "green",
  main: "blue",
};

const TONE_SET = new Set<string>(MAIL_TAG_TONES);

/** Свои метки храним как `Текст|tone`, пресеты — просто имя. */
export function parseMailTag(raw: string): { label: string; tone: MailTagTone | null } {
  const s = String(raw || "").trim();
  const i = s.lastIndexOf("|");
  if (i > 0) {
    const label = s.slice(0, i).replace(/^#+/, "").trim().replace(/\s+/g, " ");
    const tone = s.slice(i + 1).trim().toLowerCase();
    if (label && TONE_SET.has(tone)) {
      return { label: label.slice(0, 22), tone: tone as MailTagTone };
    }
  }
  const label = s.replace(/^#+/, "").trim().replace(/\s+/g, " ").slice(0, 22);
  return { label, tone: null };
}

export function formatMailTag(label: string, tone?: string | null): string {
  const clean = String(label || "")
    .replace(/^#+/, "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 22);
  if (!clean) return "";
  const t = String(tone || "").trim().toLowerCase();
  if (t && TONE_SET.has(t)) return `${clean}|${t}`;
  return clean;
}

export function mailTagLabel(tag: string): string {
  return parseMailTag(tag).label;
}

export function cleanMailTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (item && typeof item === "object" && "label" in (item as object)) {
      const row = item as { label?: string; tone?: string };
      const encoded = formatMailTag(String(row.label || ""), row.tone);
      if (encoded.length < 2) continue;
      const label = mailTagLabel(encoded).toLowerCase();
      if (out.some((x) => mailTagLabel(x).toLowerCase() === label)) continue;
      out.push(encoded);
    } else {
      const { label, tone } = parseMailTag(String(item));
      const encoded = formatMailTag(label, tone);
      if (encoded.length < 2) continue;
      const key = mailTagLabel(encoded).toLowerCase();
      if (out.some((x) => mailTagLabel(x).toLowerCase() === key)) continue;
      out.push(encoded);
    }
    if (out.length >= MAIL_TAG_MAX) break;
  }
  return out;
}

export function mailTagTone(tag: string): string {
  const { label, tone } = parseMailTag(tag);
  if (tone) return tone;
  const key = label.trim().toLowerCase();
  if (NAMED[key]) return NAMED[key];
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 33 + key.charCodeAt(i)) >>> 0;
  return MAIL_TAG_TONES[h % MAIL_TAG_TONES.length];
}

/** Разделы для кнопки «вставить ссылку» в письме. */
export const MAIL_SECTION_LINKS: { path: string; label: string }[] = [
  { path: "/tournaments", label: "Турниры" },
  { path: "/battle-pass", label: "Battle Pass" },
  { path: "/public", label: "Рейтинг паблика" },
  { path: "/cw", label: "Клановые войны" },
  { path: "/cw-find", label: "Поиск КВ" },
  { path: "/tm", label: "Тренировочные матчи" },
  { path: "/aim", label: "Тренировка стрельбы" },
  { path: "/clans", label: "Кланы" },
  { path: "/map", label: "Карта" },
  { path: "/profile", label: "Профиль" },
  { path: "/", label: "Главная" },
];

export function safeMailGoPath(path: string): string | null {
  const p = String(path || "").trim();
  if (!p.startsWith("/") || p.startsWith("//")) return null;
  if (p.includes("://") || p.includes("\\") || p.includes("<")) return null;
  if (!/^\/[a-zA-Z0-9/_?=#&\-%.]*$/.test(p)) return null;
  return p.slice(0, 180);
}

export function formatMailGoLink(path: string, label: string): string {
  const p = safeMailGoPath(path);
  const name = String(label || "")
    .trim()
    .replace(/[\[\]]/g, "")
    .slice(0, 40);
  if (!p || name.length < 1) return "";
  return `[[go:${p}|${name}]]`;
}
