"use client";

import { signIn, signOut, useSession } from "next-auth/react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { subscribeLive } from "@/lib/liveClient";
import { setVisibleInterval } from "@/lib/visibleInterval";
import { PlayerSearch } from "@/components/PlayerSearch";

type Props = {
  betaLabel?: string;
};

export function AuthBar({ betaLabel }: Props) {
  const { data: session, status } = useSession();
  const [admin, setAdmin] = useState(false);
  const loginPrompted = useRef(false);

  useEffect(() => {
    if (status !== "unauthenticated" || loginPrompted.current) return;
    if (typeof window === "undefined") return;
    const sp = new URLSearchParams(window.location.search);
    if (sp.get("login") !== "1") return;
    loginPrompted.current = true;
    void signIn("steam", { callbackUrl: "/" });
  }, [status]);


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
    const unsub = subscribeLive("/api/live/me", "user", () => {
      void checkAdmin();
    });
    // Was 60s — under evening load this + tickets/invites hammered Next.
    const clearPoll = setVisibleInterval(() => void checkAdmin(), 180_000);
    return () => {
      unsub();
      clearPoll();
    };
  }, [checkAdmin, session?.user?.profileComplete]);

  const beta = betaLabel ? (
    <p className="site-beta" aria-label="Версия сайта">
      {betaLabel}
    </p>
  ) : null;

  if (status === "loading") {
    return (
      <div className="auth-bar">
        <div className="auth-bar-main muted">…</div>
      </div>
    );
  }

  if (!session?.user) {
    return (
      <div className="auth-bar">
        <div className="auth-bar-stack">
          <div className="auth-bar-row">
            <button
              type="button"
              id="auth-login-btn"
              className="btn steam"
              onClick={() => signIn("steam", { callbackUrl: "/register" })}
            >
              Войти
            </button>
          </div>
          {beta}
        </div>
      </div>
    );
  }

  const label = session.user.nick || session.user.steamName || "Игрок";
  const avatar = session.user.avatarUrl;

  return (
    <div className="auth-bar">
      {session.user.profileComplete ? <PlayerSearch /> : null}
      <div className="auth-bar-stack">
        <div className="auth-bar-row">
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
          <Link className="nick-link" href="/profile" title={label}>
            {label}
          </Link>
          {admin ? (
            <Link className="btn primary" href="/admin">
              Админ
            </Link>
          ) : null}
          {!session.user.profileComplete ? (
            <Link className="btn ghost auth-finish-btn" href="/register">
              <span className="nav-full">Завершить регистрацию</span>
              <span className="nav-short">Анкету</span>
            </Link>
          ) : null}
          <button
            type="button"
            className="btn ghost auth-logout-btn"
            onClick={() => signOut({ callbackUrl: "/" })}
          >
            <span className="nav-full">Выйти</span>
            <span className="nav-short">✕</span>
          </button>
        </div>
        {beta}
      </div>
    </div>
  );
}
