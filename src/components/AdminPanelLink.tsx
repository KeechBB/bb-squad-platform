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
      if (!res.ok) return;
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
    const id = window.setInterval(() => void check(), 8000);
    void check();
    return () => {
      es?.close();
      window.clearInterval(id);
    };
  }, [check]);

  if (!admin) return null;

  return (
    <div style={{ marginTop: 18 }}>
      <Link className="btn primary" href="/admin">
        Войти в админ панель
      </Link>
    </div>
  );
}
