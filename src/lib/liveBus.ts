type Listener = (payload: string) => void;

const channels = new Map<string, Set<Listener>>();

export function liveSubscribe(channel: string, fn: Listener) {
  let set = channels.get(channel);
  if (!set) {
    set = new Set();
    channels.set(channel, set);
  }
  set.add(fn);
  return () => {
    set!.delete(fn);
    if (set!.size === 0) channels.delete(channel);
  };
}

export function livePublish(channel: string, payload: string = "{}") {
  const set = channels.get(channel);
  if (!set) return;
  for (const fn of set) {
    try {
      fn(payload);
    } catch {
      /* ignore */
    }
  }
}

export function clanLiveChannel(clanId: string) {
  return `clan:${clanId}`;
}

export function userLiveChannel(userId: string) {
  return `user:${userId}`;
}

/** Общий канал сайта: посещаемость, журнал, админка */
export function siteLiveChannel() {
  return "site:all";
}

export function livePublishSite(payload: Record<string, unknown>) {
  livePublish(siteLiveChannel(), JSON.stringify(payload));
}
