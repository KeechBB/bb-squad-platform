import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { AvatarEditor } from "@/components/AvatarEditor";
import { isAdmin, syncBuiltinAdmins } from "@/lib/admin";
import { prisma } from "@/lib/prisma";
import { ClanInvites } from "@/components/ClanInvites";
import { AdminPanelLink } from "@/components/AdminPanelLink";
import { ProfileEditForm } from "@/components/ProfileEditForm";
import { ProfileKvMatchHistory } from "@/components/ProfileKvStats";
import { ProfileStatsTabs } from "@/components/ProfileStatsTabs";
import { ProfileHitmapCard } from "@/components/ProfileHitmapCard";
import { TrainingSessionsCard, TrainingMatchHistory } from "@/components/TrainingSessionsCard";
import { ProfilePublicRatingCard } from "@/components/ProfilePublicRatingCard";
import { LivePageRefresh } from "@/components/LivePageRefresh";
import { formatRuDate } from "@/lib/validation";
import { effectiveRole, roleLabel, type AppRole } from "@/lib/admin";
import { CLAN_ROLE_LABEL, type ClanRole } from "@/lib/clan";
import { loadUserTrainingStats } from "@/lib/trainingStats";
import { loadUserPublicAttendanceStats } from "@/lib/publicAttendance";
import { lookupPlayerPublicRp } from "@/lib/publicRp";
import { buildPlayerPublicCombatStats } from "@/lib/publicCombat";
import { buildPlayerKvStats } from "@/lib/kvStats";
import {
  lookupPlayerTrainPwr,
  buildPlayerTrainMatchHistory,
  buildPlayerTrainCombatStats,
} from "@/lib/homeTrainPwr";
import { buildPlayerCwMatchHistory } from "@/lib/homeCwPwr";
import { ProfileTrainPwrCard } from "@/components/ProfileTrainPwrCard";
import { ProfileKitsCard } from "@/components/ProfileKitsCard";
import { ProfileCareerCard } from "@/components/ProfileCareerCard";
import { isBlackberryClanMember } from "@/lib/blackberryClan";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ProfilePage() {
  const session = await getSession();
  if (!session?.user?.steamId) redirect("/");
  if (!session.user.profileComplete) redirect("/register");

  const u = session.user;
  const displayAvatar = u.avatarUrl || null;
  await syncBuiltinAdmins();
  const admin = await isAdmin(u.steamId);

  const me = await prisma.user.findUnique({
    where: { steamId: u.steamId },
    include: {
      clanMemberships: {
        include: {
          clan: { select: { id: true, name: true, tag: true, logoUrl: true } },
          title: { select: { name: true } },
        },
      },
      clanInvites: {
        where: { status: "PENDING" },
        include: {
          clan: { select: { id: true, name: true, tag: true, logoUrl: true } },
          inviter: { select: { nick: true } },
        },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!me) redirect("/");

  const isBb = await isBlackberryClanMember(me.steamId);
  const kitsLane = isBb ? "TR1" : "PB1";

  const invites =
    me.clanInvites.map((inv) => ({
      id: inv.id,
      clan: inv.clan,
      inviter: inv.inviter,
    })) || [];

  const clans = me.clanMemberships.map((m) => ({
    id: m.clan.id,
    tag: m.clan.tag,
    name: m.clan.name,
    logoUrl: m.clan.logoUrl,
    membershipLabel: [
      CLAN_ROLE_LABEL[m.role as ClanRole],
      m.title?.name || null,
    ]
      .filter(Boolean)
      .join(" · "),
  }));

  const birthRu = me.birthDate ? formatRuDate(me.birthDate) : null;
  const siteRole = roleLabel(
    effectiveRole(me.steamId, me.role as AppRole)
  );
  const nickForKv = me.nick || u.nick || "";

  // Hot SSR: header + histories. Hitmap / kits / career load client-side after paint.
  const [
    training,
    publicAtt,
    publicRp,
    publicCombat,
    kvBundle,
    trainPwr,
    matchHistory,
    cwMatchHistory,
    trainCombat,
  ] = await Promise.all([
    loadUserTrainingStats(me.id),
    loadUserPublicAttendanceStats(me.id).catch(() => ({
      sessions: [],
      presentDays: [] as string[],
      lateDays: [] as string[],
      visitBounds: {} as Record<string, { joinHm: string; leaveHm: string | null }>,
      minutes30d: 0,
      sessions30d: 0,
      openNow: false,
    })),
    nickForKv
      ? lookupPlayerPublicRp(nickForKv).catch(() => null)
      : Promise.resolve(null),
    nickForKv
      ? buildPlayerPublicCombatStats(nickForKv).catch(() => null)
      : Promise.resolve(null),
    nickForKv
      ? buildPlayerKvStats(nickForKv)
          .then((stats) => ({ stats, error: null as string | null }))
          .catch(() => ({
            stats: null,
            error: "Не удалось загрузить стату КВ" as string | null,
          }))
      : Promise.resolve({
          stats: null,
          error: null as string | null,
        }),
    nickForKv
      ? lookupPlayerTrainPwr(nickForKv).catch(() => null)
      : Promise.resolve(null),
    nickForKv
      ? buildPlayerTrainMatchHistory(nickForKv).catch(() => [])
      : Promise.resolve([]),
    nickForKv
      ? buildPlayerCwMatchHistory(nickForKv).catch(() => [])
      : Promise.resolve([]),
    nickForKv
      ? buildPlayerTrainCombatStats(nickForKv).catch(() => null)
      : Promise.resolve(null),
  ]);

  const kvStats = kvBundle.stats;
  const kvError = kvBundle.error;

  return (
    <main className="profile-page">
      <div className="profile-area-head">
        <div className="profile-head-cluster">
          <div className="profile-head-main">
            <AvatarEditor
              nick={me.nick || u.nick || "Игрок"}
              name={me.name || u.name || ""}
              initialAvatar={displayAvatar}
              steamAvatar={u.steamAvatar || null}
              adminLink={<AdminPanelLink initialAdmin={admin} />}
              lastSeenAt={me.lastSeenAt}
            />
            <ProfileTrainPwrCard
              stats={trainPwr}
              compareNick={nickForKv}
            />
            <ProfilePublicRatingCard
              nick={nickForKv}
              rp={publicRp?.rp ?? null}
              rankLabel={publicRp?.rankLabel ?? null}
              rankKey={publicRp?.rankKey ?? null}
              combat={publicCombat}
              matches={publicRp?.matches ?? []}
            />
            <ProfileKitsCard
              userId={me.id}
              allowTr1={isBb}
              initialLane={kitsLane}
            />
            <ClanInvites initial={invites} />
          </div>
          {nickForKv ? (
            <ProfileCareerCard nick={nickForKv} self />
          ) : null}
        </div>
      </div>

      <div className="profile-area-account">
        <ProfileEditForm
          initial={{
            nick: me.nick || "",
            name: me.name || "",
            birthDate: birthRu,
            age: me.age,
            discordTag: me.discordTag,
            discordId: me.discordId,
            telegram: me.telegram,
            steamId: me.steamId,
            steamName: me.steamName,
            siteRole,
            regNo: me.regNo,
            clans,
          }}
        />
        <ProfileStatsTabs
          kvStats={kvStats}
          kvError={kvError}
          trainStats={trainCombat}
          publicStats={publicCombat}
        />
      </div>

      <div className="profile-area-hitmap">
        <ProfileHitmapCard
          userId={me.id}
          subtitle="TR1+TR2"
          matchHistory={matchHistory}
        />
      </div>

      <div className="profile-area-training">
        <LivePageRefresh intervalMs={15000} />
        <TrainingSessionsCard
          sessions={training.sessions}
          presentDays={training.presentDays}
          lateDays={training.lateDays}
          reserveDays={training.reserveDays}
          visitBounds={training.visitBounds}
          minutes30d={training.minutes30d}
          sessions30d={training.sessions30d}
          openNow={training.openNow}
          includeMatchHistory={false}
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
      </div>

      <div className="profile-area-kv-hist">
        <ProfileKvMatchHistory
          matchHistory={cwMatchHistory}
          highlightNick={nickForKv}
        />
      </div>
      <div className="profile-area-train-hist">
        <TrainingMatchHistory
          matchHistory={matchHistory}
          highlightNick={nickForKv}
        />
      </div>
    </main>
  );
}
