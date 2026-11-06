"use client";

import { useEffect, useRef } from "react";
import { subscribeLive } from "@/lib/liveClient";

type Options = {
  /** URL SSE. Канал /api/live/site — только админка. */
  url?: string;
  /** Открывать SSE. На публичных страницах выключено: канал модератора даёт 403. */
  sse?: boolean;
  /** Fallback-поллинг, мс */
  intervalMs?: number;
  /** Доп. фильтр по типу события site (attendance | journal | …) */
  kinds?: string[];
  enabled?: boolean;
};

/**
 * Автообновление без F5: общий SSE + поллинг.
 * Пока вкладка скрыта — не долбим API.
 */
export function useAutoRefresh(
  onRefresh: () => void | Promise<void>,
  opts: Options = {}
) {
  const {
    url = "/api/live/site",
    sse = false,
    intervalMs = 15000,
    kinds,
    enabled = true,
  } = opts;
  const cb = useRef(onRefresh);
  cb.current = onRefresh;
  const kindsRef = useRef(kinds);
  kindsRef.current = kinds;

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    let timer: number | null = null;
    let debounce: number | null = null;
    let inFlight = false;

    const run = () => {
      if (cancelled || document.visibilityState === "hidden") return;
      if (inFlight) return;
      inFlight = true;
      void Promise.resolve(cb.current()).finally(() => {
        inFlight = false;
      });
    };

    const schedule = (payload?: string) => {
      if (kindsRef.current?.length && payload) {
        try {
          const j = JSON.parse(payload) as { kind?: string };
          if (j.kind && !kindsRef.current.includes(j.kind)) return;
        } catch {
          /* any event */
        }
      }
      if (debounce != null) window.clearTimeout(debounce);
      debounce = window.setTimeout(run, 400);
    };

    const unsub = sse
      ? subscribeLive(url, "site", (data) => schedule(data))
      : () => {};

    timer = window.setInterval(run, intervalMs);

    const onVis = () => {
      if (document.visibilityState === "visible") run();
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      cancelled = true;
      if (timer != null) window.clearInterval(timer);
      if (debounce != null) window.clearTimeout(debounce);
      document.removeEventListener("visibilitychange", onVis);
      unsub();
    };
  }, [url, sse, intervalMs, enabled]);
}
