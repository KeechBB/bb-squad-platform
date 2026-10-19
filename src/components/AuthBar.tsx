"use client";

import { signIn, signOut, useSession } from "next-auth/react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { subscribeLive } from "@/lib/liveClient";
import { setVisibleInterval } from "@/lib/visibleInterval";
import { PlayerSearch } from "@/components/PlayerSearch";

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
