import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { AvatarEditor } from "@/components/AvatarEditor";
import { isAdmin, syncBuiltinAdmins } from "@/lib/admin";
import { prisma } from "@/lib/prisma";
import { ClanInvites } from "@/components/ClanInvites";
import { ReservePanel } from "@/components/ReservePanel";
import { AdminPanelLink } from "@/components/AdminPanelLink";
import { ProfileEditForm } from "@/components/ProfileEditForm";
import { TrainingSessionsCard } from "@/components/TrainingSessionsCard";
import { LivePageRefresh } from "@/components/LivePageRefresh";
import { ProfileKvStats } from "@/components/ProfileKvStats";
import { formatRuDate, isActiveReserve } from "@/lib/validation";
import { effectiveRole, roleLabel, type AppRole } from "@/lib/admin";
import { loadUserTrainingStats } from "@/lib/trainingStats";
import { buildPlayerKvStats } from "@/lib/kvStats";
import { ReactionBestCard } from "@/components/ReactionBestCard";
import { REACTION_LEVEL } from "@/lib/reaction";

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
        include: { clan: { select: { id: true, name: true, tag: true, logoUrl: true } } },
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

  const invites =
    me.clanInvites.map((inv) => ({
      id: inv.id,
      clan: inv.clan,
      inviter: inv.inviter,
    })) || [];

  const clans = me.clanMemberships.map((m) => m.clan) || [];
  const reserveActive = isActiveReserve(me.reserveUntil);
  const reserveUntilLabel =
    me.reserveUntil && reserveActive ? formatRuDate(me.reserveUntil) : null;

  const birthRu = me.birthDate ? formatRuDate(me.birthDate) : null;
  const siteRole = roleLabel(
    effectiveRole(me.steamId, me.role as AppRole)
  );
  const training = await loadUserTrainingStats(me.id);
  const nickForKv = me.nick || u.nick || "";
  let kvStats = null as Awaited<ReturnType<typeof buildPlayerKvStats>> | null;
  let kvError: string | null = null;
  if (nickForKv) {
    try {
      kvStats = await buildPlayerKvStats(nickForKv);
    } catch {
      kvError = "Не удалось загрузить стату КВ";
    }
  }

  const [reactionBest, reactionHistory] = await Promise.all([
    prisma.reactionRun.findFirst({
      where: { userId: me.id, level: REACTION_LEVEL },
      orderBy: { avgMs: "asc" },
      select: { avgMs: true },
    }),
    prisma.reactionRun.findMany({
      where: { userId: me.id, level: REACTION_LEVEL },
      orderBy: { createdAt: "desc" },
      take: 15,
      select: { id: true, avgMs: true, createdAt: true },
    }),
  ]);

  return (
    <main className="profile-page">
      <div className="profile-area-head">
        <div className="profile-head-cluster">
          <AvatarEditor
            nick={me.nick || u.nick || "Игрок"}
            name={me.name || u.name || ""}
            initialAvatar={displayAvatar}
            steamAvatar={u.steamAvatar || null}
            adminLink={<AdminPanelLink initialAdmin={admin} />}
            lastSeenAt={me.lastSeenAt}
          />
          <ReservePanel
            compact
            active={reserveActive}
            untilLabel={reserveUntilLabel}
            reason={reserveActive ? me.reserveReason || null : null}
          />
          <ReactionBestCard
            bestAvgMs={reactionBest?.avgMs ?? null}
            history={reactionHistory.map((h) => ({
              id: h.id,
              avgMs: h.avgMs,
              createdAt: h.createdAt.toISOString(),
            }))}
          />
        </div>
      </div>

      <div className="profile-area-side">
        <ClanInvites initial={invites} />
        {clans.length > 0 ? (
          <section className="card">
            <h2>Клан</h2>
            <div className="clan-list" style={{ marginTop: 8 }}>
              {clans.map((c) => (
                <Link key={c.id} className="clan-row" href={`/clans/${c.id}`}>
                  {c.logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img className="clan-row-logo" src={c.logoUrl} alt="" width={40} height={40} />
                  ) : (
                    <div className="clan-row-logo clan-row-logo-empty">{c.tag.slice(0, 2)}</div>
                  )}
                  <div className="clan-row-body">
                    <strong>
                      [{c.tag}] {c.name}
                    </strong>
                    <span className="muted">Открыть страницу клана</span>
                  </div>
                  <span className="clan-row-arrow">→</span>
                </Link>
              ))}
            </div>
          </section>
        ) : null}
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
          }}
        />
        <ProfileKvStats stats={kvStats} error={kvError} />
      </div>

      <div className="profile-area-training">
        <LivePageRefresh intervalMs={15000} />
        <TrainingSessionsCard
          sessions={training.sessions}
          presentDays={training.presentDays}
          visitBounds={training.visitBounds}
          minutes30d={training.minutes30d}
          sessions30d={training.sessions30d}
          openNow={training.openNow}
        />
      </div>
    </main>
  );
}
