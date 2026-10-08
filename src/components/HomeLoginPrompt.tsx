"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { SteamAuthModal } from "@/components/SteamAuthModal";

/** ?login=1 на главной — окно Steam (редирект с закрытых разделов). */
export function HomeLoginPrompt() {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (sp.get("login") === "1") setOpen(true);
  }, [sp]);

  function close() {
    setOpen(false);
    const next = new URLSearchParams(sp.toString());
    next.delete("login");
    const q = next.toString();
    router.replace(q ? `${pathname}?${q}` : pathname);
  }

  return (
    <SteamAuthModal
      open={open}
      onClose={close}
      callbackUrl="/"
      title="Нужен вход через Steam"
      message="Этот раздел доступен после авторизации через Steam."
    />
  );
}
