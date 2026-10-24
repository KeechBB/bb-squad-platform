"use client";

import Link from "next/link";
import { signIn } from "next-auth/react";

function CardBody() {
  return (
    <>
      <p className="home-net-kicker">Сеть</p>
      <p className="home-net-title">Твоя страница</p>
      <p className="home-net-text">Аватар, темы, лента и чат клана.</p>
      <p className="home-net-cta">Открыть свою страницу →</p>
    </>
  );
}

export function HomeNetAnnounce({ nick }: { nick: string | null }) {
  if (nick) {
    return (
      <Link
        className="home-net-announce"
        href={`/profile/web/${encodeURIComponent(nick)}`}
        aria-label="Открыть свою страницу в Сети"
      >
        <CardBody />
      </Link>
    );
  }
  return (
    <button
      type="button"
      className="home-net-announce"
      aria-label="Войти и открыть свою страницу в Сети"
      onClick={() => void signIn("steam", { callbackUrl: "/profile/web" })}
    >
      <CardBody />
    </button>
  );
}
