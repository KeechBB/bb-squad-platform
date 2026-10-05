"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signIn, useSession } from "next-auth/react";
import type { ReactNode } from "react";

type Props = {
  showClanSections: boolean;
};

function pathMatches(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavItem({
  href,
  title,
  full,
  short,
  mode,
  className,
  active,
}: {
  href: string;
  title?: string;
  full: string;
  short: string;
  mode: "link" | "login" | "register";
  className?: string;
  active?: boolean;
}) {
  const cls = ["nav-link", active ? "is-active" : "", className || ""]
    .filter(Boolean)
    .join(" ");
  if (mode === "login") {
    return (
      <button
        type="button"
        className={["nav-login-trigger", cls].filter(Boolean).join(" ")}
        title={title || "Войти через Steam"}
        aria-current={active ? "page" : undefined}
        onClick={() => signIn("steam", { callbackUrl: href })}
      >
        <span className="nav-full">{full}</span>
        <span className="nav-short">{short}</span>
      </button>
    );
  }
  if (mode === "register") {
    return (
      <Link
        href="/register"
        title="Завершите регистрацию"
        className={cls}
        aria-current={active ? "page" : undefined}
      >
        <span className="nav-full">{full}</span>
        <span className="nav-short">{short}</span>
      </Link>
    );
  }
  return (
    <Link
      href={href}
      title={title}
      className={cls}
      aria-current={active ? "page" : undefined}
    >
      <span className="nav-full">{full}</span>
      <span className="nav-short">{short}</span>
    </Link>
  );
}

export function SiteNav({ showClanSections }: Props) {
  const pathname = usePathname() || "/";
  const { data: session, status } = useSession();
  const loading = status === "loading";
  const authed = Boolean(session?.user?.steamId);
  const complete = Boolean(session?.user?.profileComplete);

  let mode: "link" | "login" | "register" = "link";
  if (!loading) {
    if (!authed) mode = "login";
    else if (!complete) mode = "register";
  }

  const clanBlock: ReactNode = showClanSections ? (
    <>
      <NavItem
        href="/cw"
        title="Клановые войны"
        full="Клановые войны"
        short="КВ"
        mode={mode}
        active={pathMatches(pathname, "/cw")}
      />
      <NavItem
        href="/tm"
        title="Тренировочные матчи"
        full="Тренировочные матчи"
        short="Трен."
        mode={mode}
        active={pathMatches(pathname, "/tm")}
      />
    </>
  ) : null;

  return (
    <nav className="top-nav" aria-label="Разделы">
      <NavItem
        href="/"
        full="Главная"
        short="Глав"
        mode="link"
        active={pathMatches(pathname, "/")}
      />
      {clanBlock}
      <NavItem
        href="/clans"
        full="Кланы"
        short="Кланы"
        mode={mode}
        active={pathMatches(pathname, "/clans")}
      />
      <NavItem
        href="/aim"
        title="Тренировка стрельбы"
        full="Тренировка стрельбы"
        short="Стрельба"
        mode={mode}
        active={pathMatches(pathname, "/aim")}
      />
      <NavItem
        href="/public"
        title="Рейтинг паблика"
        full="Рейтинг паблика"
        short="Паблик"
        mode="link"
        className="nav-public-pill"
        active={pathMatches(pathname, "/public")}
      />
      {showClanSections ? (
        <NavItem
          href="/map"
          title="Карта клана"
          full="Карта клана"
          short="Карта"
          mode={mode}
          active={pathMatches(pathname, "/map")}
        />
      ) : null}
    </nav>
  );
}
