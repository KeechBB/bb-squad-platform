"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Тихий router.refresh без F5: SSE /api/live/me + поллинг. */
export function LivePageRefresh({
  intervalMs = 5000,
  sseUrl = "/api/live/me",
}: {
  intervalMs?: number;
  sseUrl?: string;
}) {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      if (!cancelled) router.refresh();
    };

    let es: EventSource | null = null;
    try {
      es = new EventSource(sseUrl);
      es.addEventListener("user", refresh);
      es.onerror = () => {
        /* poll covers */
      };
    } catch {
      /* */
    }

    const id = window.setInterval(refresh, intervalMs);
    const onVis = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      cancelled = true;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
      es?.close();
    };
  }, [router, intervalMs, sseUrl]);

  return null;
}
