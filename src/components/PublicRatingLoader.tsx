"use client";

import { useEffect, useState } from "react";
import { PublicRatingClient } from "@/components/PublicRatingClient";
import type { PublicCombatRow } from "@/lib/publicCombat";
import type { PublicMatchRow } from "@/lib/publicMatches";

type Payload = {
  rows: PublicCombatRow[];
  matches: number;
  updatedAt?: string;
  matchHistory: PublicMatchRow[];
};

export function PublicRatingLoader() {
  const [data, setData] = useState<Payload | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/public/rating-page", {
          credentials: "same-origin",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as Payload;
        if (!cancelled) setData(json);
      } catch (e) {
        if (!cancelled) {
          setErr(e instanceof Error ? e.message : "load failed");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (err) {
    return (
      <p className="muted" style={{ padding: "1.5rem" }}>
        Не удалось загрузить рейтинг паблика: {err}
      </p>
    );
  }
  if (!data) {
    return (
      <p className="muted" style={{ padding: "1.5rem" }}>
        Загрузка рейтинга паблика…
      </p>
    );
  }

  return (
    <PublicRatingClient
      rows={data.rows}
      matches={data.matches}
      matchHistory={data.matchHistory}
      updatedAt={data.updatedAt}
    />
  );
}
