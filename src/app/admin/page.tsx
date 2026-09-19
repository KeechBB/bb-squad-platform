import { getSession } from "@/lib/auth";
import { isAdminSteamId } from "@/lib/admin";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import Link from "next/link";
import { AdminUsersTable } from "@/components/AdminUsersTable";

export default async function AdminPage() {
  const session = await getSession();
  if (!session?.user?.steamId) redirect("/");
  if (!isAdminSteamId(session.user.steamId)) redirect("/profile");

  const users = await prisma.user.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      steamId: true,
      steamName: true,
      name: true,
      nick: true,
      age: true,
      profileComplete: true,
      createdAt: true,
    },
  });

  const rows = users.map((u) => ({
    ...u,
    createdAt: u.createdAt.toISOString(),
  }));

  return (
    <main className="admin-page">
      <section className="hero">
        <p className="eyebrow">админ</p>
        <h1>Панель</h1>
        <p className="lead">Пользователи платформы. Кликни по нику — правка анкеты.</p>
        <div className="admin-tabs" role="tablist">
          <span className="admin-tab active">Пользователи</span>
        </div>
        <p style={{ marginTop: 12 }}>
          <Link className="kv-link" href="/profile">
            ← В профиль
          </Link>
        </p>
      </section>

      <AdminUsersTable initialUsers={rows} />
    </main>
  );
}
