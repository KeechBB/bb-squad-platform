import { getSession } from "@/lib/auth";
import {
  effectiveRole,
  isAdmin,
  isBuiltinAdmin,
  syncBuiltinAdmins,
  type AppRole,
} from "@/lib/admin";
import { prisma } from "@/lib/prisma";
import { redirect, notFound } from "next/navigation";
import { AdminUserEditForm } from "@/components/AdminUserEditForm";

type Props = { params: Promise<{ id: string }> };

export default async function AdminUserPage({ params }: Props) {
  const session = await getSession();
  if (!session?.user?.steamId) redirect("/");
  await syncBuiltinAdmins();
  if (!(await isAdmin(session.user.steamId))) redirect("/profile");

  const { id } = await params;
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) notFound();

  const role = effectiveRole(user.steamId, user.role as AppRole);

  return (
    <main className="admin-page">
      <section className="hero">
        <p className="eyebrow">админ · пользователь</p>
        <h1>{user.nick || user.steamName || "Игрок"}</h1>
        <p className="lead">Правка анкеты и роли.</p>
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
          createdAt: user.createdAt.toISOString(),
        }}
        roleLocked={
          isBuiltinAdmin(user.steamId) || user.steamId === session.user.steamId
        }
      />
    </main>
  );
}
