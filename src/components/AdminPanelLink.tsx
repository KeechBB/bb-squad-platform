"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { subscribeLive } from "@/lib/liveClient";

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
    void check();
    const unsub = subscribeLive("/api/live/me", "user", () => {
      void check();
    });
    return () => unsub();
  }, [check]);

  if (!admin) return null;

  return (
    <Link className="btn primary admin-panel-btn-inline" href="/admin">
      Админ панель
    </Link>
  );
}
