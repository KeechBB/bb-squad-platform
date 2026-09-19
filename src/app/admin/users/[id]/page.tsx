import { getSession } from "@/lib/auth";
import {
  assignableRoles,
  canChangeRole,
  effectiveRole,
  getUserRole,
  isAdmin,
  syncBuiltinAdmins,
  type AppRole,
} from "@/lib/admin";
import { prisma } from "@/lib/prisma";
import { redirect, notFound } from "next/navigation";
import { AdminUserEditForm } from "@/components/AdminUserEditForm";

type Props = { params: Promise<{ id: string }> };

function resolveAvatarSrc(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith("/uploads/avatars/")) {
    return url.replace("/uploads/avatars/", "/api/avatars/");
  }
  return url;
}

export default async function AdminUserPage({ params }: Props) {
  const session = await getSession();
  if (!session?.user?.steamId) redirect("/");
  await syncBuiltinAdmins();
  if (!(await isAdmin(session.user.steamId))) redirect("/profile");

  const { id } = await params;
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) notFound();

  const role = effectiveRole(user.steamId, user.role as AppRole);
  const actorRole = (await getUserRole(session.user.steamId)) || "USER";
  const roleOptions = assignableRoles(actorRole);
  const canEditRole =
    user.steamId !== session.user.steamId &&
    canChangeRole(actorRole, role, user.steamId);

  return (
    <main className="admin-page">
      <section className="hero">
        <p className="eyebrow">админ · пользователь</p>
        <h1>{user.nick || user.steamName || "Игрок"}</h1>
        <p className="lead">Правка анкеты, роли и аватара.</p>
      </section>
      <AdminUserEditForm
        user={{
          id: user.id,
          steamId: user.steamId,
          steamName: user.steamName,
          name: user.name,
          nick: user.nick,
          age: user.age,
          role,
          avatarUrl: resolveAvatarSrc(user.avatarUrl),
          createdAt: user.createdAt.toISOString(),
        }}
        canEditRole={canEditRole}
        roleOptions={roleOptions}
      />
    </main>
  );
}
