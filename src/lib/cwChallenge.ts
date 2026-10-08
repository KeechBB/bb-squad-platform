/** Моды КВ на площадке. */
export const CW_MODES = [
  { id: "HOTDROP", label: "Hotdrop" },
  { id: "CSL", label: "CSL" },
  { id: "FCL", label: "FCL" },
  { id: "SEC", label: "SEC" },
] as const;

export type CwModeId = (typeof CW_MODES)[number]["id"];

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

export function modeLabel(mode: string): string {
  return CW_MODES.find((m) => m.id === mode)?.label || mode;
}
