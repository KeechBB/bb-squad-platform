"use client";

import { useEffect, useState } from "react";

const POLL_MS = 30_000;

/** LIVE-style online counter in the top-left corner (replaces brand mark). */
export function SiteOnlineBadge() {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/presence/online", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { count?: number };
        if (!cancelled) setCount(Math.max(0, Number(data.count) || 0));
      } catch {
        /* keep previous */
      }
    };
    void load();
    const id = window.setInterval(() => void load(), POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const label = count == null ? "…" : String(count);

  return (
    <div
      className="site-online-badge"
      title="Сейчас на сайте"
      aria-label={`Online: ${label}`}
    >
      <i aria-hidden />
      <span className="site-online-label">Online:</span>
      <span className="site-online-count">{label}</span>
    </div>
  );
}
