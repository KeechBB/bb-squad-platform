"use client";

/**
 * Один EventSource на URL на всё приложение.
 * Иначе AuthBar + LivePageRefresh + ClanInvites + Support + …
 * открывают 4–6 одинаковых SSE и браузер упирается в лимит соединений
 * → клики по навигации «замирают» без индикатора загрузки.
 */

type Listener = (data: string) => void;

type ChannelState = {
  es: EventSource;
  refs: number;
  byEvent: Map<string, Set<Listener>>;
  boundEvents: Set<string>;
};

const channels = new Map<string, ChannelState>();

function bindEvent(ch: ChannelState, url: string, event: string) {
  if (ch.boundEvents.has(event)) return;
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

export function subscribeLive(
  url: string,
  event: string,
  listener: Listener
): () => void {
  if (typeof window === "undefined") return () => {};

  let ch = channels.get(url);
  if (!ch) {
    const es = new EventSource(url);
    ch = {
      es,
      refs: 0,
      byEvent: new Map(),
      boundEvents: new Set(),
    };
    channels.set(url, ch);
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
      cur.es.close();
      channels.delete(url);
    }
  };
}

/** Принудительно закрыть канал (например после 403 на staff SSE). */
export function closeLive(url: string) {
  const ch = channels.get(url);
  if (!ch) return;
  ch.es.close();
  channels.delete(url);
}
