import type { AppRole } from "@/lib/roles";
import { effectiveRole } from "@/lib/admin";

export const SUPPORT_DISPLAY_NAME = "Тех. поддержка";

export const SUPPORT_WELCOME =
  "Появились вопросы по навигации сайта? Задай — тебе ответят и помогут в короткие сроки.";

export const SUPPORT_BOT_WAITING =
  "Уважаемый пользователь, модератор подключится в ближайшее время.";

export const SUPPORT_TOPICS = [
  { id: "suggestion", label: "Предложения по улучшению" },
  { id: "bug", label: "Нашел БАГ" },
  { id: "question", label: "Вопросы" },
] as const;

export type SupportTopicId = (typeof SUPPORT_TOPICS)[number]["id"];

export function supportTopicLabel(topic: string | null | undefined): string {
  return SUPPORT_TOPICS.find((t) => t.id === topic)?.label || "";
}

export function isSupportTopic(v: string): v is SupportTopicId {
  return SUPPORT_TOPICS.some((t) => t.id === v);
}

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
