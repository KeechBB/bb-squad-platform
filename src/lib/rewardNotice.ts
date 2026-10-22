import { prisma } from "@/lib/prisma";

export type RewardNoticeInput = {
  userId: string;
  /** Один ключ на награду. Повтор не создаёт вторую карточку. */
  dedupeKey: string;
  title: string;
  body: string;
  href?: string | null;
  linkLabel?: string | null;
  imageUrl?: string | null;
};

/** Карточка в колокольчик. Если игрок уже закрыл её — не открывать снова. */
export async function notifyRewardUnlock(input: RewardNoticeInput): Promise<void> {
  const dedupeKey = input.dedupeKey.trim();
  if (!input.userId || !dedupeKey || !input.title.trim()) return;
  const existing = await prisma.userNotice.findUnique({
    where: { userId_dedupeKey: { userId: input.userId, dedupeKey } },
    select: { id: true },
  });
  if (existing) return;
  await prisma.userNotice.create({
    data: {
      userId: input.userId,
      dedupeKey,
      kind: "reward",
      title: input.title.trim(),
      body: input.body.trim(),
      href: input.href || null,
      linkLabel: input.linkLabel || null,
      imageUrl: input.imageUrl || null,
    },
  });
}
