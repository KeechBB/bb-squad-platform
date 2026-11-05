/** Faction info text + style (stored as JSON in Faction.info, with plain-text fallback). */

export type FactionInfoDoc = {
  v: 1;
  text: string;
  font: string;
  color: string;
};

export const FACTION_INFO_FONTS = [
  { id: "Oxanium", label: "Oxanium" },
  { id: "Manrope", label: "Manrope" },
  { id: "Arial", label: "Arial" },
  { id: "Georgia", label: "Georgia" },
  { id: "Impact", label: "Impact" },
] as const;

export const FACTION_INFO_COLORS = [
  "#f7f3ff",
  "#f0c987",
  "#c4b5fd",
  "#34d399",
  "#f87171",
  "#38bdf8",
  "#fb923c",
  "#ffffff",
] as const;

/** Наш набор смайлов для текста фракции. */
export const FACTION_EMOJIS = [
  "🫐",
  "🍓",
  "🍒",
  "🍇",
  "🍉",
  "🔥",
  "⚔️",
  "🛡️",
  "💀",
  "🎯",
  "🏆",
  "💪",
  "😈",
  "🐺",
  "🦅",
  "⚡",
  "💥",
  "🎖️",
  "🖤",
  "💜",
  "🚀",
  "👑",
] as const;

export const DEFAULT_FACTION_INFO_DOC: FactionInfoDoc = {
  v: 1,
  text: "",
  font: "Oxanium",
  color: "#f7f3ff",
};

export function parseFactionInfo(raw: string | null | undefined): FactionInfoDoc {
  const s = String(raw || "").trim();
  if (!s) return { ...DEFAULT_FACTION_INFO_DOC };
  if (s.startsWith("{")) {
    try {
      const parsed = JSON.parse(s) as Partial<FactionInfoDoc>;
      if (parsed && typeof parsed === "object") {
        return {
          v: 1,
          text: String(parsed.text ?? "").slice(0, 2000),
          font:
            FACTION_INFO_FONTS.some((f) => f.id === parsed.font)
              ? String(parsed.font)
              : DEFAULT_FACTION_INFO_DOC.font,
          color:
            typeof parsed.color === "string" && /^#[0-9a-fA-F]{6}$/.test(parsed.color)
              ? parsed.color
              : DEFAULT_FACTION_INFO_DOC.color,
        };
      }
    } catch {
      /* plain text */
    }
  }
  return { ...DEFAULT_FACTION_INFO_DOC, text: s.slice(0, 2000) };
}

export function stringifyFactionInfo(doc: FactionInfoDoc): string {
  return JSON.stringify({
    v: 1,
    text: doc.text.slice(0, 2000),
    font: doc.font,
    color: doc.color,
  });
}
