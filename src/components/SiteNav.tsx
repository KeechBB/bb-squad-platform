"use client";

import Link from "next/link";
import { signIn, useSession } from "next-auth/react";
import type { ReactNode } from "react";

type Props = {
  showClanSections: boolean;
};

function NavItem({
  href,
  title,
  full,
  short,
  mode,
  className,
}: {
  href: string;
  title?: string;
  full: string;
  short: string;
  mode: "link" | "login" | "register";
  className?: string;
}) {
  const cls = className?.trim() || undefined;
  if (mode === "login") {
    return (
      <button
        type="button"
        className={["nav-login-trigger", cls].filter(Boolean).join(" ")}
        title={title || "Войти через Steam"}
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
      >
        <span className="nav-full">{full}</span>
        <span className="nav-short">{short}</span>
      </Link>
    );
  }
  return (
    <Link href={href} title={title} className={cls}>
      <span className="nav-full">{full}</span>
      <span className="nav-short">{short}</span>
    </Link>
  );
}

export function SiteNav({ showClanSections }: Props) {
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
      />
      <NavItem
        href="/tm"
        title="Тренировочные матчи"
        full="Тренировочные матчи"
        short="Трен."
        mode={mode}
      />
    </>
  ) : null;

  return (
    <nav className="top-nav" aria-label="Разделы">
      <NavItem href="/" full="Главная" short="Глав" mode="link" />
      {clanBlock}
      <NavItem href="/clans" full="Кланы" short="Кланы" mode={mode} />
      <NavItem
        href="/aim"
        title="Тренировка стрельбы"
        full="Тренировка стрельбы"
        short="Стрельба"
        mode={mode}
      />
      <NavItem
        href="/public"
        title="Рейтинг паблика"
        full="Рейтинг паблика"
        short="Паблик"
        mode="link"
        className="nav-public-pill"
      />
      {showClanSections ? (
        <NavItem
          href="/map"
          title="Карта клана"
          full="Карта клана"
          short="Карта"
          mode={mode}
        />
      ) : null}
    </nav>
  );
}
