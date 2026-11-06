"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { subscribeLive } from "@/lib/liveClient";

/** Тихий router.refresh только когда пришло живое событие, без поминутной пересборки страницы. */
export function LivePageRefresh({
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

    const onVis = () => {
      if (document.visibilityState === "visible") schedule();
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      cancelled = true;
      if (debounce != null) window.clearTimeout(debounce);
      document.removeEventListener("visibilitychange", onVis);
      unsub();
    };
  }, [router, sseUrl]);

  return null;
}
