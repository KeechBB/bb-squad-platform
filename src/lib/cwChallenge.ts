/** Моды КВ. Аватарки Workshop → public/cw-modes/<slug>.jpg (без ссылок на Steam). */
export const CW_MODES = [
  { id: "HOTDROP", label: "Hotdrop", image: "/cw-modes/hotdrop.jpg" },
  { id: "CSL", label: "CSL", image: "/cw-modes/csl.jpg" },
  { id: "FCL", label: "FCL", image: "/cw-modes/fcl.jpg" },
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
