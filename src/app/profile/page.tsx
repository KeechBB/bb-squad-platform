import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";

/** KV on GitHub Pages; HTTPS cert for kv.* not ready yet — use HTTP until Pages shows the lock. */
const KV_TABLE_URL = "http://kv.bb-squad.ru/";

export default async function ProfilePage() {
  const session = await getSession();
  if (!session?.user?.steamId) redirect("/");
  if (!session.user.profileComplete) redirect("/register");

  const u = session.user;

  return (
    <main className="profile-grid">
      <section className="hero">
        <p className="eyebrow">профиль</p>
        <h1>{u.nick}</h1>
        <p className="lead">{u.name}</p>
      </section>

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
      </section>

      <section className="stats-stub">
        <strong style={{ color: "var(--ink)" }}>Статистика</strong>
        <p style={{ margin: "8px 0 0" }}>
          Скоро: КВ, тренировки, K/D. Пока смотри публичную таблицу слотов.
        </p>
        <a
          className="kv-link"
          href={KV_TABLE_URL}
          target="_blank"
          rel="noopener noreferrer"
        >
          Таблица КВ →
        </a>
      </section>
    </main>
  );
}
