"use client";

import Link from "next/link";
import { SessionProvider } from "next-auth/react";
import { usePathname, useRouter } from "next/navigation";
import { SiteNav } from "@/components/SiteNav";
import { AuthBar } from "@/components/AuthBar";
import { TouchCompact } from "@/components/TouchCompact";
import { SupportChatWidget } from "@/components/SupportChatWidget";
import { SiteFooter } from "@/components/SiteFooter";
import { session } from "./fixtures";

export function PreviewShell({ children, empty }: { children: React.ReactNode; empty: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  return (
    <SessionProvider session={session} refetchInterval={0} refetchOnWindowFocus={false}>
      <TouchCompact />
      <details className="preview-toolbar" aria-label="Локальное окружение">
        <summary>LOCAL UI · Тестовые данные</summary>
        <div className="preview-toolbar-controls">
        <Link href="/">Главная</Link><Link href="/profile">Профиль</Link><Link href="/public">Рейтинг</Link>
        <label>Данные <select aria-label="Набор тестовых данных" defaultValue={empty ? "empty" : "populated"} onChange={(e) => {
          document.cookie = `bb-preview-state=${e.target.value}; path=/; SameSite=Lax`;
          sessionStorage.clear();
          window.location.reload();
        }}><option value="populated">Заполненные</option><option value="empty">Пустые</option></select></label>
        <button type="button" onClick={() => { router.push(pathname === "/profile" ? "/" : "/profile"); }}>Сменить экран</button>
        </div>
      </details>
      <header className="site-top"><div className="site-top-inner"><div className="top-left"><SiteNav showClanSections /></div><AuthBar /></div></header>
      <div className="shell">{children}</div>
      <SiteFooter betaLabel="LOCAL PREVIEW" />
      <SupportChatWidget />
    </SessionProvider>
  );
}
