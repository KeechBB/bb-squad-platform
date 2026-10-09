/**
 * Моды КВ. Картинки в public/cw-modes/ (локальные файлы сайта, не Steam CDN).
 * FCL: канон — Fruit Cup League crest (прозрачный PNG). Не брать старый jpg/аватар
 * из Steam Workshop мода — на сайте всегда fcl.png.
 */
export const CW_MODES = [
  { id: "HOTDROP", label: "Hotdrop", image: "/cw-modes/hotdrop.jpg" },
  { id: "CSL", label: "CSL", image: "/cw-modes/csl.jpg" },
  { id: "FCL", label: "FCL", image: "/cw-modes/fcl.png" },
  { id: "SEC", label: "SEC", image: "/cw-modes/sec.jpg" },
] as const;

export type CwModeId = (typeof CW_MODES)[number]["id"];

/** Формат стороны: N vs N */
export const CW_FORMATS = [8, 16, 20, 26, 30, 36] as const;

export type CwFormat = (typeof CW_FORMATS)[number];

/**
 * Пул наших серверов. Назначается после нахождения матча.
 * Приоритет: TR2 → … → TR5, затем FCL ARENA 2→4.
 */
export const CW_SERVER_POOL = [
  { id: "TR2", label: "TR2", priority: 1 },
  { id: "TR3", label: "TR3", priority: 2 },
  { id: "TR4", label: "TR4", priority: 3 },
  { id: "TR5", label: "TR5", priority: 4 },
  { id: "FCL_ARENA_2", label: "FCL ARENA 2", priority: 5 },
  { id: "FCL_ARENA_3", label: "FCL ARENA 3", priority: 6 },
  { id: "FCL_ARENA_4", label: "FCL ARENA 4", priority: 7 },
] as const;

export const CW_SERVER_POOL_NOTE =
  "По умолчанию наши серверы (TR2–TR5, FCL ARENA 2–4). Приоритет TR2, далее по возрастанию. Сервер назначается после нахождения матча.";

export function isCwMode(v: string): v is CwModeId {
  return CW_MODES.some((m) => m.id === v);
}

export function isCwFormat(v: number): v is CwFormat {
  return (CW_FORMATS as readonly number[]).includes(v);
}

export function modeLabel(mode: string): string {
  return CW_MODES.find((m) => m.id === mode)?.label || mode;
}

export function formatLabel(format: number): string {
  return `${format}vs${format}`;
}

/** Разбор формата из KV size: «20v20» / «20vs20» / «20» — не склеивать в 2020. */
export function parseCwFormat(size: string | number | null | undefined): number | null {
  if (typeof size === "number" && Number.isFinite(size)) {
    return isCwFormat(size) ? size : null;
  }
  const s = String(size || "").trim();
  if (!s || s === "—") return null;
  const vs = s.match(/(\d{1,2})\s*v(?:s)?\s*\d{1,2}/i);
  if (vs) {
    const n = Number(vs[1]);
    if (isCwFormat(n)) return n;
  }
  for (const f of [...CW_FORMATS].sort((a, b) => b - a)) {
    if (new RegExp(`(?:^|\\b)${f}(?:\\b|$)`).test(s)) return f;
  }
  if (/^\d{1,2}$/.test(s)) {
    const n = Number(s);
    if (isCwFormat(n)) return n;
  }
  return null;
}

/** Угадать мод из строки карты / modeLabel (KV: «SEC 26 Mutaha…», «HotDrop Narva»). */
export function detectCwModeFromText(raw: string): CwModeId {
  const s = String(raw || "").toUpperCase();
  if (/\bCSL\b/.test(s)) return "CSL";
  if (/\bFCL\b/.test(s)) return "FCL";
  if (/\bSEC\b/.test(s) || /\bBALT\b/.test(s)) return "SEC";
  if (/HOT\s*DROP|HOTDROP/.test(s)) return "HOTDROP";
  return "HOTDROP";
}

export function modeImage(mode: string): string {
  const id = isCwMode(mode) ? mode : detectCwModeFromText(mode);
  return CW_MODES.find((m) => m.id === id)?.image || "/cw-modes/hotdrop.jpg";
}

/** Cache-bust for mode art (bump when replacing public/cw-modes/*). */
export const CW_MODE_IMAGE_V = "4";

