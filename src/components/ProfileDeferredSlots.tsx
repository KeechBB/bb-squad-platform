import { TrainingSessionsCard } from "@/components/TrainingSessionsCard";
import { ProfilePublicRatingCard } from "@/components/ProfilePublicRatingCard";
import { ProfileTrainPwrCard } from "@/components/ProfileTrainPwrCard";
import { loadUserTrainingStats } from "@/lib/trainingStats";
import { loadUserPublicAttendanceStats } from "@/lib/publicAttendance";
import { lookupPublicProfileSummary } from "@/lib/publicCombat";
import { lookupPlayerTrainPwr } from "@/lib/homeTrainPwr";

/** Поток: карточка тренировочного PWR без блокировки shell. */
export async function ProfileTrainPwrSlot({ nick }: { nick: string }) {
  const trainPwr = nick
    ? await lookupPlayerTrainPwr(nick).catch(() => null)
    : null;
  return <ProfileTrainPwrCard stats={trainPwr} compareNick={nick} />;
}

/** Поток: паблик RP/combat без блокировки shell. */
export async function ProfilePublicRatingSlot({ nick }: { nick: string }) {
  const summary = nick
    ? await lookupPublicProfileSummary(nick).catch(() => null)
    : null;
  return (
    <ProfilePublicRatingCard
      nick={nick}
      rp={summary?.rp?.rp ?? null}
      rankLabel={summary?.rp?.rankLabel ?? null}
      rankKey={summary?.rp?.rankKey ?? null}
      combat={summary?.combat ?? null}
      matches={summary?.rp?.matches ?? []}
    />
  );
}

/** Поток: календари TR1/TR2/PB1 без блокировки shell. */
export async function ProfileTrainingSlot({ userId }: { userId: string }) {
  const [training, publicAtt] = await Promise.all([
    loadUserTrainingStats(userId),
    loadUserPublicAttendanceStats(userId).catch(() => ({
      sessions: [],
      presentDays: [] as string[],
      lateDays: [] as string[],
      visitBounds: {} as Record<
        string,
        { joinHm: string; leaveHm: string | null }
      >,
      minutes30d: 0,
      sessions30d: 0,
      openNow: false,
    })),
  ]);

  return (
    <TrainingSessionsCard
      sessions={training.tr1.sessions}
      presentDays={training.tr1.presentDays}
      lateDays={training.tr1.lateDays}
      reserveDays={training.tr1.reserveDays}
      dayOffDays={training.tr1.dayOffDays}
      visitBounds={training.tr1.visitBounds}
      minutes30d={training.tr1.minutes30d}
      sessions30d={training.tr1.sessions30d}
      openNow={training.tr1.openNow}
      includeMatchHistory={false}
      tr2Lane={{
        sessions: training.tr2.sessions,
        presentDays: training.tr2.presentDays,
        lateDays: training.tr2.lateDays,
        reserveDays: training.tr2.reserveDays,
        dayOffDays: training.tr2.dayOffDays,
        visitBounds: training.tr2.visitBounds,
        minutes30d: training.tr2.minutes30d,
        sessions30d: training.tr2.sessions30d,
        openNow: training.tr2.openNow,
      }}
      publicLane={{
        sessions: publicAtt.sessions,
        presentDays: publicAtt.presentDays,
        lateDays: publicAtt.lateDays,
        visitBounds: publicAtt.visitBounds,
        minutes30d: publicAtt.minutes30d,
        sessions30d: publicAtt.sessions30d,
        openNow: publicAtt.openNow,
      }}
    />
  );
}
