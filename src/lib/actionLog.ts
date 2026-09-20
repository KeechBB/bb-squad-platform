import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type ActionCategory = "admin" | "clan" | "profile";

export type WriteActionLogInput = {
  category: ActionCategory;
  action: string;
  message: string;
  actorId?: string | null;
  actorNick?: string | null;
  targetId?: string | null;
  targetNick?: string | null;
  clanId?: string | null;
  clanTag?: string | null;
  meta?: Record<string, unknown> | null;
};

export function personLabel(u: {
  nick?: string | null;
  name?: string | null;
  steamName?: string | null;
  steamId?: string | null;
}): string {
  return u.nick || u.name || u.steamName || u.steamId || "—";
}

/** Пишет событие в журнал. Ошибки не роняют основной запрос. */
export async function writeActionLog(input: WriteActionLogInput): Promise<void> {
  try {
    const parts = [
      input.message,
      input.actorNick,
      input.targetNick,
      input.clanTag,
      input.action,
      input.category,
    ]
      .filter(Boolean)
      .join(" ");
    await prisma.actionLog.create({
      data: {
        category: input.category,
        action: input.action,
        message: input.message,
        searchText: parts.toLowerCase(),
        actorId: input.actorId ?? null,
        actorNick: input.actorNick ?? null,
        targetId: input.targetId ?? null,
        targetNick: input.targetNick ?? null,
        clanId: input.clanId ?? null,
        clanTag: input.clanTag ?? null,
        meta:
          input.meta == null
            ? undefined
            : (input.meta as Prisma.InputJsonValue),
      },
    });
  } catch (err) {
    console.error("[actionLog]", err);
  }
}
