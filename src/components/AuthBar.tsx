"use client";

import { signIn, signOut, useSession } from "next-auth/react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { subscribeLive } from "@/lib/liveClient";
import { setVisibleInterval } from "@/lib/visibleInterval";
import { PlayerSearch } from "@/components/PlayerSearch";

function DiscordHeaderLink() {
  return (
    <a
      className="nav-discord"
      href="https://discord.gg/UptthuJ3a"
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Discord сервер BlackBerry"
      title="Discord сервер BlackBerry"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          fill="currentColor"
          d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"
        />
      </svg>
      <span>Discord</span>
    </a>
  );
}

export function AuthBar() {
  const { data: session, status } = useSession();
  const [admin, setAdmin] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const loginPrompted = useRef(false);
  const closeTimer = useRef<number | null>(null);

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
    const clearPoll = setVisibleInterval(() => void checkAdmin(), 180_000);
    return () => {
      unsub();
      clearPoll();
    };
  }, [checkAdmin, session?.user?.profileComplete]);

  useEffect(() => {
    if (!menuOpen) return;
    function onDoc(e: MouseEvent) {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  useEffect(() => {
    return () => {
      if (closeTimer.current != null) window.clearTimeout(closeTimer.current);
    };
  }, []);

  function openMenu() {
    if (closeTimer.current != null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    setMenuOpen(true);
  }

  function scheduleCloseMenu() {
    if (closeTimer.current != null) window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => {
      setMenuOpen(false);
      closeTimer.current = null;
    }, 180);
  }

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
        <div className="auth-bar-row">
          <DiscordHeaderLink />
          <button
            type="button"
            id="auth-login-btn"
            className="btn steam"
            onClick={() => signIn("steam", { callbackUrl: "/register" })}
          >
            Войти
          </button>
        </div>
      </div>
    );
  }

  const label = session.user.nick || session.user.steamName || "Игрок";
  const avatar = session.user.avatarUrl;

  return (
    <div className="auth-bar">
      <DiscordHeaderLink />
      {session.user.profileComplete ? <PlayerSearch /> : null}
      <div
        ref={menuRef}
        className={`auth-user-dd${menuOpen ? " is-open" : ""}`}
        onMouseEnter={openMenu}
        onMouseLeave={scheduleCloseMenu}
      >
        <button
          type="button"
          className="auth-user-trigger"
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          onClick={() => setMenuOpen((v) => !v)}
        >
          {avatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              className="avatar"
              src={avatar}
              alt=""
              width={32}
              height={32}
            />
          ) : null}
          <span className="auth-user-nick">{label}</span>
          <span className="nav-dd-caret" aria-hidden>
            ▾
          </span>
        </button>
        <div className="auth-user-menu" role="menu" hidden={!menuOpen}>
          {!session.user.profileComplete ? (
            <Link
              role="menuitem"
              className="auth-user-item"
              href="/register"
              onClick={() => setMenuOpen(false)}
            >
              Завершить регистрацию
            </Link>
          ) : (
            <Link
              role="menuitem"
              className="auth-user-item"
              href="/profile"
              onClick={() => setMenuOpen(false)}
            >
              Профиль
            </Link>
          )}
          {admin ? (
            <Link
              role="menuitem"
              className="auth-user-item"
              href="/admin"
              onClick={() => setMenuOpen(false)}
            >
              Админка
            </Link>
          ) : null}
          <button
            type="button"
            role="menuitem"
            className="auth-user-item auth-user-logout"
            onClick={() => {
              setMenuOpen(false);
              void signOut({ callbackUrl: "/" });
            }}
          >
            Выйти
          </button>
        </div>
      </div>
    </div>
  );
}
