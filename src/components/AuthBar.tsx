"use client";

import { signIn, signOut, useSession } from "next-auth/react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

export function AuthBar() {
  const { data: session, status } = useSession();
  const [admin, setAdmin] = useState(false);

  const checkAdmin = useCallback(async () => {
    if (!session?.user?.profileComplete) {
      setAdmin(false);
      return;
    }
    try {
      const res = await fetch("/api/me/admin", { cache: "no-store" });
      if (!res.ok) {
        setAdmin(false);
        return;
      }
      const data = (await res.json()) as { admin?: boolean };
      setAdmin(Boolean(data.admin));
    } catch {
      /* ignore */
    }
  }, [session?.user?.profileComplete]);

  useEffect(() => {
    void checkAdmin();
    if (!session?.user?.profileComplete) return;
    let es: EventSource | null = null;
    try {
      es = new EventSource("/api/live/me");
      es.addEventListener("user", () => {
        void checkAdmin();
      });
    } catch {
      /* */
    }
    const id = window.setInterval(() => void checkAdmin(), 10000);
    return () => {
      es?.close();
      window.clearInterval(id);
    };
  }, [checkAdmin, session?.user?.profileComplete]);

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
  const avatar = session.user.avatarUrl;

  return (
    <div className="auth-bar">
      {avatar ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className="avatar"
          src={avatar}
          alt=""
          width={36}
          height={36}
        />
      ) : null}
      <Link className="nick-link" href="/profile">
        {label}
      </Link>
      {admin ? (
        <Link className="btn primary" href="/admin">
          Админ
        </Link>
      ) : null}
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
