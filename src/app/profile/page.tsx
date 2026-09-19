import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { AvatarEditor } from "@/components/AvatarEditor";
import { isAdmin, syncBuiltinAdmins } from "@/lib/admin";

export default async function ProfilePage() {
  const session = await getSession();
  if (!session?.user?.steamId) redirect("/");
  if (!session.user.profileComplete) redirect("/register");

  const u = session.user;
  const displayAvatar = u.avatarUrl || u.steamAvatar || null;
  await syncBuiltinAdmins();
  const admin = await isAdmin(u.steamId);

  return (
    <main className="profile-grid">
      <AvatarEditor
        nick={u.nick || "Игрок"}
        name={u.name || ""}
        initialAvatar={displayAvatar}
        hasCustom={Boolean(u.avatarUrl)}
      />

      <section className="card">
        <h2>Аккаунт</h2>
        <div className="meta-row">
          <span>Ник</span>
          <span>{u.nick}</span>
        </div>
        <div className="meta-row">
          <span>Имя</span>
          <span>{u.name}</span>
        </div>
        <div className="meta-row">
          <span>Возраст</span>
          <span>{u.age}</span>
        </div>
        <div className="meta-row">
          <span>Steam ID</span>
          <span>{u.steamId}</span>
        </div>
        <div className="meta-row">
          <span>Steam</span>
          <span>{u.steamName || "—"}</span>
        </div>
        {admin ? (
          <div style={{ marginTop: 18 }}>
            <Link className="btn primary" href="/admin">
              Войти в админ панель
            </Link>
          </div>
        ) : null}
      </section>

      <section className="stats-stub">
        <strong style={{ color: "var(--ink)" }}>Статистика</strong>
        <p style={{ margin: "8px 0 0" }}>
          Скоро: КВ, тренировки, K/D. Пока смотри таблицу слотов в аккаунте.
        </p>
        <Link className="kv-link" href="/cw">
          Таблица КВ →
        </Link>
      </section>
    </main>
  );
}
