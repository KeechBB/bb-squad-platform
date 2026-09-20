"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

type Props = {
  initialAdmin: boolean;
};

export function AdminPanelLink({ initialAdmin }: Props) {
  const [admin, setAdmin] = useState(initialAdmin);

  const check = useCallback(async () => {
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
  }, []);

  useEffect(() => {
    setAdmin(initialAdmin);
  }, [initialAdmin]);

  useEffect(() => {
    let es: EventSource | null = null;
    try {
      es = new EventSource("/api/live/me");
      es.addEventListener("user", () => {
        void check();
      });
    } catch {
      /* */
    }
    void check();
    let ticks = 0;
    const id = window.setInterval(() => {
      void check();
      ticks += 1;
      if (ticks > 40) window.clearInterval(id);
    }, 3000);
    return () => {
      es?.close();
      window.clearInterval(id);
    };
  }, [check]);

  if (!admin) return null;

  return (
    <Link className="btn primary admin-panel-btn-inline" href="/admin">
      Админ панель
    </Link>
  );
}
