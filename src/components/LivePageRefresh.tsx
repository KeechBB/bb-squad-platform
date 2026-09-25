"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { subscribeLive } from "@/lib/liveClient";

/** Тихий router.refresh: общий SSE + редкий поллинг; в фоне вкладки не дергаем. */
export function LivePageRefresh({
  intervalMs = 60_000,
  sseUrl = "/api/live/me",
}: {
  intervalMs?: number;
  sseUrl?: string;
}) {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    let debounce: number | null = null;
    let inFlight = false;

    const refresh = () => {
      if (cancelled || document.visibilityState === "hidden") return;
      if (inFlight) return;
      inFlight = true;
      router.refresh();
      window.setTimeout(() => {
        inFlight = false;
      }, 800);
    };

    const schedule = () => {
      if (debounce != null) window.clearTimeout(debounce);
      debounce = window.setTimeout(refresh, 400);
    };

    const unsub = subscribeLive(sseUrl, "user", () => schedule());

    const id = window.setInterval(refresh, intervalMs);
    const onVis = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      cancelled = true;
      window.clearInterval(id);
      if (debounce != null) window.clearTimeout(debounce);
      document.removeEventListener("visibilitychange", onVis);
      unsub();
    };
  }, [router, intervalMs, sseUrl]);

  return null;
}
