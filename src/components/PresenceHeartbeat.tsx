"use client";

import { useEffect } from "react";
import { useSession } from "next-auth/react";
import { SITE_HEARTBEAT_MS } from "@/lib/presence";

/**
 * Пока пользователь залогинен и вкладка видима — периодически
 * обновляет lastSeenAt («онлайн на сайте»).
 */
export function PresenceHeartbeat() {
  const { data: session, status } = useSession();

  useEffect(() => {
    if (status !== "authenticated") return;
    if (!session?.user?.profileComplete) return;

    let cancelled = false;

    async function ping() {
      if (cancelled) return;
      if (
        typeof document !== "undefined" &&
        document.visibilityState === "hidden"
      ) {
        return;
      }
      try {
        await fetch("/api/presence/heartbeat", {
          method: "POST",
          cache: "no-store",
        });
      } catch {
        /* сеть — следующий тик */
      }
    }

    void ping();
    const id = window.setInterval(() => void ping(), SITE_HEARTBEAT_MS);

    function onVis() {
      if (document.visibilityState === "visible") void ping();
    }
    document.addEventListener("visibilitychange", onVis);

    return () => {
      cancelled = true;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [status, session?.user?.profileComplete]);

  return null;
}
