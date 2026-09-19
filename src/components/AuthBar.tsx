"use client";

import { signIn, signOut, useSession } from "next-auth/react";
import Link from "next/link";

export function AuthBar() {
  const { data: session, status } = useSession();

  if (status === "loading") {
    return <div className="auth-bar muted">…</div>;
  }

  if (!session?.user) {
    return (
      <div className="auth-bar">
        <button
          type="button"
          className="btn ghost"
          onClick={() => signIn("steam", { callbackUrl: "/register" })}
        >
          Регистрация
        </button>
        <button
          type="button"
          className="btn steam"
          onClick={() => signIn("steam", { callbackUrl: "/" })}
        >
          Войти
        </button>
      </div>
    );
  }

  const label = session.user.nick || session.user.steamName || "Игрок";

  return (
    <div className="auth-bar">
      {session.user.steamAvatar ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className="avatar"
          src={session.user.steamAvatar}
          alt=""
          width={36}
          height={36}
        />
      ) : null}
      <Link className="nick-link" href="/profile">
        {label}
      </Link>
      {!session.user.profileComplete ? (
        <Link className="btn ghost" href="/register">
          Завершить регистрацию
        </Link>
      ) : null}
      <button type="button" className="btn ghost" onClick={() => signOut({ callbackUrl: "/" })}>
        Выйти
      </button>
    </div>
  );
}
