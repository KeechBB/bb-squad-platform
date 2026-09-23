"use client";

import { useEffect, useRef } from "react";
import { useSession } from "next-auth/react";
import { usePathname } from "next/navigation";
import { SITE_HEARTBEAT_MS } from "@/lib/presence";

function postPageview(path: string) {
  void fetch("/api/presence/pageview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
    cache: "no-store",
  }).catch(() => {
    /* ignore */
  });
}

/**
 * Heartbeat онлайна + лог каждого открытия страницы (и возврата на вкладку).
 */
export function PresenceHeartbeat() {
  const { data: session, status } = useSession();
  const pathname = usePathname();
  const ready =
    status === "authenticated" && Boolean(session?.user?.profileComplete);
  const lastSent = useRef<{ path: string; at: number } | null>(null);

  useEffect(() => {
    if (!ready) return;

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
  }, [ready]);

  useEffect(() => {
    if (!ready || !pathname) return;

    function send(force = false) {
      if (
        typeof document !== "undefined" &&
        document.visibilityState === "hidden"
      ) {
        return;
      }
      const now = Date.now();
      const prev = lastSent.current;
      // только антидребезг ~2с на тот же path
      if (
        !force &&
        prev &&
        prev.path === pathname &&
        now - prev.at < 2000
      ) {
        return;
      }
      lastSent.current = { path: pathname, at: now };
      postPageview(pathname);
    }

    send(true);

    function onVis() {
      if (document.visibilityState === "visible") send(true);
    }
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [pathname, ready]);

  return null;
}
