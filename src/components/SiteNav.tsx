"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { SteamAuthModal } from "@/components/SteamAuthModal";

type Props = {
  /** Полный доступ: КВ / Поиск КВ / ТМ — только если в клане */
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

function NavDropdown({
  label,
  short,
  active,
  children,
}: {
  label: string;
  short: string;
  active?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div
      ref={rootRef}
      className={`nav-dd${active ? " is-active" : ""}${open ? " is-open" : ""}`}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        className={`nav-link nav-dd-trigger${active ? " is-active" : ""}`}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="nav-full">{label}</span>
        <span className="nav-short">{short}</span>
        <span className="nav-dd-caret" aria-hidden>
          ▾
        </span>
      </button>
      <div className="nav-dd-menu" role="menu" hidden={!open}>
        {children}
      </div>
    </div>
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

  const clansActive =
    pathMatches(pathname, "/clans") ||
    pathMatches(pathname, "/cw") ||
    pathMatches(pathname, "/cw-find");

  const trainActive =
    pathMatches(pathname, "/tm") ||
    pathMatches(pathname, "/tiers-fit") ||
    pathMatches(pathname, "/aim");

  function openAuth(href: string, title: string, message: string) {
    setAuthModal({ href, title, message });
  }

  function menuItem(
    href: string,
    label: string,
    opts?: { clanOnly?: boolean; accent?: string }
  ) {
    const active = pathMatches(pathname, href);
    const cls = [
      "nav-dd-item",
      active ? "is-active" : "",
      opts?.accent || "",
    ]
      .filter(Boolean)
      .join(" ");

    if (guest) {
      return (
        <button
          key={href}
          type="button"
          role="menuitem"
          className={cls}
          onClick={() =>
            openAuth(
              href,
              `${label} — только после входа`,
              "Авторизуйтесь через Steam, чтобы открыть раздел."
            )
          }
        >
          {label}
        </button>
      );
    }
    if (needRegister) {
      return (
        <Link key={href} href="/register" role="menuitem" className={cls}>
          {label}
        </Link>
      );
    }
    if (opts?.clanOnly && !showClanSections) {
      return (
        <Link
          key={href}
          href="/clans"
          role="menuitem"
          className={cls}
          title="Доступно участникам клана"
        >
          {label}
        </Link>
      );
    }
    return (
      <Link key={href} href={href} role="menuitem" className={cls}>
        {label}
      </Link>
    );
  }

  return (
    <>
      <nav className="top-nav" aria-label="Разделы">
        <NavLink
          href="/"
          full="Главная"
          short="Глав"
          active={pathMatches(pathname, "/")}
        />

        <NavLink
          href="/public"
          title="Рейтинг паблика"
          full="Рейтинг паблика"
          short="Паблик"
          className="nav-public-quiet"
          active={pathMatches(pathname, "/public")}
        />

        <NavDropdown label="Кланы" short="Кланы" active={clansActive}>
          {menuItem("/clans", "Список кланов")}
          {menuItem("/cw", "Клановые войны", { clanOnly: true })}
          {menuItem("/cw-find", "Поиск КВ", {
            clanOnly: true,
            accent: "nav-dd-accent",
          })}
        </NavDropdown>

        <NavDropdown label="Тренировка" short="Трен." active={trainActive}>
          {menuItem("/tm", "Тренировочные матчи", { clanOnly: true })}
          {menuItem("/aim", "Тренировка стрельбы")}
        </NavDropdown>

        <NavLink
          href="/battle-pass"
          title="Battle Pass"
          full="Battle Pass"
          short="BP"
          className="nav-battle-pass"
          active={pathMatches(pathname, "/battle-pass")}
        />
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
