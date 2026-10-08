"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { useState, type ReactNode } from "react";
import { SteamAuthModal } from "@/components/SteamAuthModal";

type Props = {
  /** Полный доступ: КВ / ТМ / карта — только если пользователь в каком-либо клане */
  showClanSections: boolean;
};

function pathMatches(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavLink({
  href,
  title,
  full,
  short,
  className,
  active,
}: {
  href: string;
  title?: string;
  full: string;
  short: string;
  className?: string;
  active?: boolean;
}) {
  const cls = ["nav-link", active ? "is-active" : "", className || ""]
    .filter(Boolean)
    .join(" ");
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

function NavGateButton({
  title,
  full,
  short,
  active,
  onClick,
}: {
  title: string;
  full: string;
  short: string;
  active?: boolean;
  onClick: () => void;
}) {
  const cls = ["nav-link", "nav-login-trigger", active ? "is-active" : ""]
    .filter(Boolean)
    .join(" ");
  return (
    <button
      type="button"
      className={cls}
      title={title}
      aria-current={active ? "page" : undefined}
      onClick={onClick}
    >
      <span className="nav-full">{full}</span>
      <span className="nav-short">{short}</span>
    </button>
  );
}

export function SiteNav({ showClanSections }: Props) {
  const pathname = usePathname() || "/";
  const { data: session, status } = useSession();
  const loading = status === "loading";
  const authed = Boolean(session?.user?.steamId);
  const complete = Boolean(session?.user?.profileComplete);

  const [authModal, setAuthModal] = useState<{
    href: string;
    title: string;
    message: string;
  } | null>(null);

  const guest = !loading && !authed;
  const needRegister = !loading && authed && !complete;

  const clanBlock: ReactNode = showClanSections ? (
    <>
      <NavLink
        href="/cw"
        title="Клановые войны"
        full="Клановые войны"
        short="КВ"
        active={pathMatches(pathname, "/cw")}
      />
      <NavLink
        href="/tm"
        title="Тренировочные матчи"
        full="Тренировочные матчи"
        short="Трен."
        active={pathMatches(pathname, "/tm")}
      />
    </>
  ) : null;

  return (
    <>
      <nav className="top-nav" aria-label="Разделы">
        <NavLink
          href="/"
          full="Главная"
          short="Глав"
          active={pathMatches(pathname, "/")}
        />
        {clanBlock}
        {guest ? (
          <NavGateButton
            title="Кланы"
            full="Кланы"
            short="Кланы"
            active={pathMatches(pathname, "/clans")}
            onClick={() =>
              setAuthModal({
                href: "/clans",
                title: "Кланы — только после входа",
                message:
                  "Авторизуйтесь через Steam, чтобы открыть раздел кланов.",
              })
            }
          />
        ) : needRegister ? (
          <NavLink
            href="/register"
            title="Завершите регистрацию"
            full="Кланы"
            short="Кланы"
            active={pathMatches(pathname, "/clans")}
          />
        ) : (
          <NavLink
            href="/clans"
            full="Кланы"
            short="Кланы"
            active={pathMatches(pathname, "/clans")}
          />
        )}
        {guest ? (
          <NavGateButton
            title="Тренировка стрельбы"
            full="Тренировка стрельбы"
            short="Стрельба"
            active={pathMatches(pathname, "/aim")}
            onClick={() =>
              setAuthModal({
                href: "/aim",
                title: "Тренировка стрельбы — только после входа",
                message:
                  "Авторизуйтесь через Steam, чтобы открыть тренировку стрельбы.",
              })
            }
          />
        ) : needRegister ? (
          <NavLink
            href="/register"
            title="Завершите регистрацию"
            full="Тренировка стрельбы"
            short="Стрельба"
            active={pathMatches(pathname, "/aim")}
          />
        ) : (
          <NavLink
            href="/aim"
            title="Тренировка стрельбы"
            full="Тренировка стрельбы"
            short="Стрельба"
            active={pathMatches(pathname, "/aim")}
          />
        )}
        <NavLink
          href="/public"
          title="Рейтинг паблика"
          full="Рейтинг паблика"
          short="Паблик"
          className="nav-public-pill"
          active={pathMatches(pathname, "/public")}
        />
        {showClanSections ? (
          <NavLink
            href="/map"
            title="Карта игроков"
            full="Карта игроков"
            short="Карта"
            active={pathMatches(pathname, "/map")}
          />
        ) : null}
      </nav>
      <SteamAuthModal
        open={Boolean(authModal)}
        onClose={() => setAuthModal(null)}
        callbackUrl={authModal?.href || "/"}
        title={authModal?.title}
        message={authModal?.message}
      />
    </>
  );
}
