"use client";

/**
 * Один EventSource на URL на всё приложение.
 * Обрыв не переподключается каждую секунду: пауза растёт до минуты,
 * иначе консоль забивается 401/403/503, а браузер держит лишние сокеты.
 */

type Listener = (data: string) => void;

type ChannelState = {
  es: EventSource | null;
  refs: number;
  byEvent: Map<string, Set<Listener>>;
  boundEvents: Set<string>;
  retry: number;
  timer: number | null;
};

const channels = new Map<string, ChannelState>();

function bindEvent(ch: ChannelState, url: string, event: string) {
  if (!ch.es || ch.boundEvents.has(event)) return;
  ch.boundEvents.add(event);
  ch.es.addEventListener(event, ((ev: Event) => {
    const data = String((ev as MessageEvent).data ?? "");
    const listeners = channels.get(url)?.byEvent.get(event);
    if (!listeners) return;
    for (const fn of listeners) {
      try {
        fn(data);
      } catch {
        /* ignore listener errors */
      }
    }
  }) as EventListener);
}

function attach(url: string, ch: ChannelState) {
  if (ch.refs <= 0) return;
  if (ch.es) {
    ch.es.close();
    ch.es = null;
  }
  ch.boundEvents.clear();
  const es = new EventSource(url);
  ch.es = es;
  for (const event of ch.byEvent.keys()) bindEvent(ch, url, event);
  es.onopen = () => {
    ch.retry = 0;
  };
  es.onerror = () => {
    es.close();
    if (ch.es === es) ch.es = null;
    ch.boundEvents.clear();
    if (ch.refs <= 0) return;
    if (ch.timer != null) window.clearTimeout(ch.timer);
    const wait = Math.min(60_000, 4_000 * 2 ** ch.retry);
    ch.retry = Math.min(ch.retry + 1, 4);
    ch.timer = window.setTimeout(() => {
      ch.timer = null;
      if (ch.refs > 0) attach(url, ch);
    }, wait);
  };
}

export function subscribeLive(
  url: string,
  event: string,
  listener: Listener
): () => void {
  if (typeof window === "undefined") return () => {};

  let ch = channels.get(url);
  if (!ch) {
    ch = {
      es: null,
      refs: 0,
      byEvent: new Map(),
      boundEvents: new Set(),
      retry: 0,
      timer: null,
    };
    channels.set(url, ch);
    attach(url, ch);
  }

  ch.refs += 1;
  if (!ch.byEvent.has(event)) ch.byEvent.set(event, new Set());
  ch.byEvent.get(event)!.add(listener);
  bindEvent(ch, url, event);

  return () => {
    const cur = channels.get(url);
    if (!cur) return;
    cur.byEvent.get(event)?.delete(listener);
    cur.refs -= 1;
    if (cur.refs <= 0) {
      if (cur.timer != null) window.clearTimeout(cur.timer);
      cur.es?.close();
      channels.delete(url);
    }
  };
}

/** Принудительно закрыть канал (например после 403 на staff SSE). */
export function closeLive(url: string) {
  const ch = channels.get(url);
  if (!ch) return;
  if (ch.timer != null) window.clearTimeout(ch.timer);
  ch.es?.close();
  channels.delete(url);
}
