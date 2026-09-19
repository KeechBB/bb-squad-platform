import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";

/** KV on GitHub Pages; HTTPS cert for kv.* not ready yet — use HTTP until Pages shows the lock. */
const KV_TABLE_URL = "http://kv.bb-squad.ru/";

export default async function HomePage() {
  const session = await getSession();
  if (session?.user?.steamId && !session.user.profileComplete) {
    redirect("/register");
  }
  if (session?.user?.profileComplete) {
    redirect("/profile");
  }

  return (
    <main>
      <section className="hero">
        <p className="eyebrow">bbsquad · platform</p>
        <h1>BLACKBERRY</h1>
        <p className="lead">
          Клановая платформа Squad. Войди через Steam, укажи ник латиницей —
          аккаунт сразу готов. Статистика профиля появится позже.
        </p>
      </section>

      <section className="card">
        <h2>Как начать</h2>
        <p className="muted">
          Нажми «Войти через Steam» сверху. После первого входа заполним имя,
          ник и возраст — и ты в системе.
        </p>
        <a
          className="kv-link"
          href={KV_TABLE_URL}
          target="_blank"
          rel="noopener noreferrer"
        >
          Таблица КВ (публичная) →
        </a>
      </section>
    </main>
  );
}
