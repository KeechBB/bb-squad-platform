"use client";

import { useEffect, useRef } from "react";
import { subscribeLive } from "@/lib/liveClient";

/** Подписка на SSE-событие через общий EventSource (один сокет на URL). */
export function useLiveEvent(
  url: string | null | undefined,
  event: string,
  onEvent: (data: string) => void,
  enabled = true
) {
  const cb = useRef(onEvent);
  cb.current = onEvent;

  useEffect(() => {
    if (!enabled || !url) return;
    return subscribeLive(url, event, (data) => cb.current(data));
  }, [url, event, enabled]);
}
