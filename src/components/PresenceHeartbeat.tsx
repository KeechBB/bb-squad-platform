"use client";

import { useEffect, useRef } from "react";
import { useSession } from "next-auth/react";
import { usePathname } from "next/navigation";
import { SITE_HEARTBEAT_MS } from "@/lib/presence";

const VID_KEY = "bb_vid";

function getClientKey(): string {
  try {
    let k = localStorage.getItem(VID_KEY);
    if (k && /^[a-zA-Z0-9_-]{8,64}$/.test(k)) return k;
    k =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID().replace(/-/g, "")
        : `v${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
    localStorage.setItem(VID_KEY, k);
    return k;
  } catch {
    return `tmp${Date.now().toString(36)}`;
  }
}

function readUtm(): {
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
} {
  try {
    const q = new URLSearchParams(window.location.search);
    return {
      utmSource: q.get("utm_source"),
      utmMedium: q.get("utm_medium"),
      utmCampaign: q.get("utm_campaign"),
    };
  } catch {
    return { utmSource: null, utmMedium: null, utmCampaign: null };
  }
}

function postPageview(payload: Record<string, string | null>) {
  void fetch("/api/presence/pageview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store",
  }).catch(() => {
    /* ignore */
  });
}

/**
 * Онлайн-heartbeat (только залогиненные) + лог трафика для всех посетителей.
 */
export function PresenceHeartbeat() {
  const { data: session, status } = useSession();
  const pathname = usePathname();
  const authed =
    status === "authenticated" && Boolean(session?.user?.profileComplete);
  const lastSent = useRef<{ path: string; at: number } | null>(null);

  useEffect(() => {
    if (!authed) return;

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
        /* ignore */
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
  }, [authed]);

  useEffect(() => {
    if (!pathname) return;

    function send(force = false) {
      if (
        typeof document !== "undefined" &&
        document.visibilityState === "hidden"
      ) {
        return;
      }
      const now = Date.now();
      const prev = lastSent.current;
      if (!force && prev && prev.path === pathname && now - prev.at < 2000) {
        return;
      }
      lastSent.current = { path: pathname, at: now };

      let referrer: string | null = null;
      try {
        referrer = document.referrer || null;
      } catch {
        referrer = null;
      }
      const utm = readUtm();

      postPageview({
        clientKey: getClientKey(),
        path: pathname,
        referrer,
        ...utm,
      });
    }

    send(true);
    function onVis() {
      if (document.visibilityState === "visible") send(true);
    }
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [pathname, status]);

  return null;
}
