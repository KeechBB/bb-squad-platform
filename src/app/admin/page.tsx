import { getSession } from "@/lib/auth";
import {
  assignableRoles,
  canChangeRole,
  canDeleteUser,
  effectiveRole,
  getUserRole,
  isAdmin,
  syncBuiltinAdmins,
  type AppRole,
} from "@/lib/admin";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import Link from "next/link";
import { AdminUsersTable } from "@/components/AdminUsersTable";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AdminPage() {
  const session = await getSession();
  if (!session?.user?.steamId) redirect("/");
  await syncBuiltinAdmins();
  if (!(await isAdmin(session.user.steamId))) redirect("/profile");

  const actorRole = (await getUserRole(session.user.steamId)) || "USER";
  const roleOptions = assignableRoles(actorRole);

  const users = await prisma.user.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      steamId: true,
      steamName: true,
      name: true,
      nick: true,
      age: true,
      role: true,
      profileComplete: true,
      createdAt: true,
    },
  });

  const rows = users.map((u) => {
    const role = effectiveRole(u.steamId, u.role as AppRole);
    return {
      id: u.id,
      steamId: u.steamId,
      steamName: u.steamName,
      name: u.name,
      nick: u.nick,
      age: u.age,
      role,
      profileComplete: u.profileComplete,
      createdAt: u.createdAt.toISOString(),
      canEditRole:
        u.steamId !== session.user.steamId &&
        canChangeRole(actorRole, role, u.steamId),
      canDelete: canDeleteUser(
        actorRole,
        role,
        u.steamId,
        u.steamId === session.user.steamId
      ),
    };
  });

  return (
    <main className="admin-page">
      <section className="hero">
        <p className="eyebrow">админ</p>
        <h1>Панель</h1>
        <p className="lead">
          Пользователи платформы. Кликни по нику — правка анкеты и аватара.
          Удаление (в т.ч. незавершённых) — главный админ и HR.
        </p>
        <div className="admin-tabs" role="tablist">
          <span className="admin-tab active">Пользователи</span>
        </div>
        <p style={{ marginTop: 12 }}>
          <Link className="kv-link" href="/profile">
            ← В профиль
          </Link>
        </p>
      </section>

      <AdminUsersTable
        initialUsers={rows}
        roleOptions={roleOptions}
        actorRole={actorRole}
      />
    </main>
  );
}
