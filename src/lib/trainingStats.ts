import { prisma } from "@/lib/prisma";
import { formatDurationMinutes } from "@/lib/squadSessions";

export async function loadUserTrainingStats(userId: string) {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const sessions = await prisma.squadServerSession.findMany({
    where: { userId },
    orderBy: { joinedAt: "desc" },
    take: 40,
  });

  const last30 = sessions.filter((s) => s.joinedAt >= since);
  const minutes30d = last30.reduce(
    (sum, s) => sum + formatDurationMinutes(s.joinedAt, s.leftAt),
    0
  );
  const openNow = sessions.some((s) => s.leftAt == null);

  return {
    sessions,
    minutes30d,
    sessions30d: last30.length,
    openNow,
  };
}
