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
import { formatRuDate, isActiveReserve } from "@/lib/validation";
import { effectiveRole, roleLabel, type AppRole } from "@/lib/admin";
import { loadUserTrainingStats } from "@/lib/trainingStats";

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

  return (
    <main className="profile-page">
      <div className="profile-area-head">
        <AvatarEditor
          nick={me.nick || u.nick || "Игрок"}
          name={me.name || u.name || ""}
          initialAvatar={displayAvatar}
          steamAvatar={u.steamAvatar || null}
        />
      </div>

      <div className="profile-area-side">
        <ClanInvites initial={invites} />
        <ReservePanel
          active={reserveActive}
          untilLabel={reserveUntilLabel}
          reason={reserveActive ? me.reserveReason || null : null}
        />
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
          adminLink={<AdminPanelLink initialAdmin={admin} />}
        />
      </div>

      <div className="profile-area-training">
        <LivePageRefresh intervalMs={5000} />
        <TrainingSessionsCard
          sessions={training.sessions}
          minutes30d={training.minutes30d}
          sessions30d={training.sessions30d}
          openNow={training.openNow}
        />
        <section className="stats-stub profile-kv-stub">
          <strong style={{ color: "var(--ink)" }}>Статистика КВ</strong>
          <p style={{ margin: "6px 0 0" }}>
            Игровая стата КВ — следующим этапом.{" "}
            <Link className="kv-link" href="/cw" style={{ marginTop: 0 }}>
              Таблица КВ →
            </Link>
          </p>
        </section>
      </div>
    </main>
  );
}
