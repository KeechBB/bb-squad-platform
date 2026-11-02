/** Готовые причины для выходного / резерва. «Другое» — свой текст. */
/** Фиксированные причины: по ним считается, сколько ушло в армию, сколько болеет и т.д. */
export const ABSENCE_REASON_PRESETS = [
  "Армия",
  "Болезнь",
  "Учёба",
  "Работа",
  "Отпуск",
  "Семья",
  "Другое",
] as const;

export type AbsenceReasonPreset = (typeof ABSENCE_REASON_PRESETS)[number];

export const ABSENCE_REASON_OTHER: AbsenceReasonPreset = "Другое";

/** Сегодня в локальной зоне → YYYY-MM-DD для min у input[type=date]. */
export function todayIsoLocal(): string {
  const n = new Date();
  const y = n.getFullYear();
  const m = String(n.getMonth() + 1).padStart(2, "0");
  const d = String(n.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function resolveAbsenceReason(
  preset: string,
  custom: string
): string {
  if (preset === ABSENCE_REASON_OTHER) {
    return String(custom || "").trim();
  }
  return String(preset || "").trim();
}
