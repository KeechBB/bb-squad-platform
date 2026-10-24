/** Пак «Фруктовый сад»: один фрукт — одна эмоция. В тексте токен :apple: */

export type NetEmoji = {
  id: string;
  label: string;
  emotion: string;
  fill: string;
  mouth: "smile" | "flat" | "love" | "angry" | "cool" | "wink" | "shy" | "laugh" | "sad" | "wow" | "think" | "sleep" | "hype" | "gg" | "cry" | "party";
};

export const NET_EMOJI: NetEmoji[] = [
  { id: "apple", label: "Яблоко", emotion: "радость", fill: "#ef4444", mouth: "smile" },
  { id: "pear", label: "Груша", emotion: "спокойствие", fill: "#84cc16", mouth: "flat" },
  { id: "cherry", label: "Вишня", emotion: "любовь", fill: "#e11d48", mouth: "love" },
  { id: "lemon", label: "Лимон", emotion: "злость", fill: "#facc15", mouth: "angry" },
  { id: "grape", label: "Виноград", emotion: "крутой", fill: "#7c3aed", mouth: "cool" },
  { id: "berry", label: "Ежевика", emotion: "подмигивание", fill: "#4c1d95", mouth: "wink" },
  { id: "peach", label: "Персик", emotion: "смущение", fill: "#fb7185", mouth: "shy" },
  { id: "melon", label: "Арбуз", emotion: "смех", fill: "#16a34a", mouth: "laugh" },
  { id: "plum", label: "Слива", emotion: "грусть", fill: "#6d28d9", mouth: "sad" },
  { id: "orange", label: "Апельсин", emotion: "удивление", fill: "#f97316", mouth: "wow" },
  { id: "kiwi", label: "Киви", emotion: "думает", fill: "#65a30d", mouth: "think" },
  { id: "banana", label: "Банан", emotion: "сон", fill: "#fde047", mouth: "sleep" },
  { id: "fig", label: "Инжир", emotion: "хайп", fill: "#9f1239", mouth: "hype" },
  { id: "lime", label: "Лайм", emotion: "салют", fill: "#22c55e", mouth: "gg" },
  { id: "apricot", label: "Абрикос", emotion: "слёзы", fill: "#fb923c", mouth: "cry" },
  { id: "garden", label: "Сад", emotion: "праздник", fill: "#15803d", mouth: "party" },
];

const BY_ID = new Map(NET_EMOJI.map((e) => [e.id, e]));

export function netEmojiById(id: string): NetEmoji | undefined {
  return BY_ID.get(id);
}

const TOKEN = /:([a-z0-9-]+):/g;

/** Текст одного поста и одной темы. Смайл считается одним знаком. */
export const NET_TEXT_MAX = 1000;

/** Смайл считается одним знаком, обычные буквы — по одной. */
export function netVisibleLength(text: string): number {
  const masked = text.replace(TOKEN, (full, id: string) => (BY_ID.has(id) ? "•" : full));
  return [...masked].length;
}

/** Длина текста без пометок жирного и размера. */
export function netPlainLength(text: string): number {
  return netVisibleLength(text.replace(/\[\[\/?(?:b|y|s:(?:md|lg|xl))\]\]/g, ""));
}
