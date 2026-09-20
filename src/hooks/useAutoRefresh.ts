"use client";

import { useEffect, useRef } from "react";

type Options = {
  /** URL SSE (по умолчанию общий сайт-канал админки) */
  url?: string;
  /** Fallback-поллинг, мс (по умолчанию 5с — как сборщик логов) */
  intervalMs?: number;
  /** Доп. фильтр по типу события site (attendance | journal | …) */
  kinds?: string[];
  enabled?: boolean;
};

/**
 * Автообновление без F5: SSE + поллинг.
 * Пока вкладка скрыта — не долбим API.
 */
export function useAutoRefresh(
  onRefresh: () => void | Promise<void>,
  opts: Options = {}
) {
  const {
    url = "/api/live/site",
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

    let es: EventSource | null = null;
    try {
      es = new EventSource(url);
      es.addEventListener("site", (ev) => {
        schedule((ev as MessageEvent).data);
      });
      es.onerror = () => {
        /* поллинг подстрахует */
      };
    } catch {
      /* */
    }

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
      es?.close();
    };
  }, [url, intervalMs, enabled]);
}
