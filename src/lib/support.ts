import type { AppRole } from "@/lib/roles";
import { effectiveRole } from "@/lib/admin";

export const SUPPORT_DISPLAY_NAME = "Тех. поддержка";

export const SUPPORT_WELCOME =
  "Появились вопросы по навигации сайта? Задай — тебе ответят и помогут в короткие сроки.";

export const SUPPORT_BOT_WAITING =
  "Уважаемый пользователь, модератор подключится в ближайшее время.";

/** HR, Админ, Зам, Главный — отвечают как «Тех. поддержка». */
export function canReplySupport(role: AppRole | null | undefined): boolean {
  return (
    role === "ADMIN" ||
    role === "HR" ||
    role === "DEPUTY" ||
    role === "SUPER_ADMIN"
  );
}

export function canReplySupportForUser(
  steamId: string,
  role: AppRole
): boolean {
  return canReplySupport(effectiveRole(steamId, role));
}
