"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useAutoRefresh } from "@/hooks/useAutoRefresh";
import {
  formatMatchDate,
  type UpcomingMatchPreview,
} from "@/lib/kvForecastUi";

type Pulse = {
  nextMatch: UpcomingMatchPreview | null;
  updatedAt: string;
};

function winTone(pct: number) {
  if (pct >= 55) return "is-good";
  if (pct <= 42) return "is-bad";
  return "is-warn";
}

function hostLabel(clan: string, bbHost: boolean) {
  if (bbHost) return "BB";
  const t = String(clan || "").trim();
  if (!t) return "—";
  if (/^blackberry$/i.test(t) || /^bb$/i.test(t)) return "BB";
  return t;
}

export function HomePulse() {
  const [data, setData] = useState<Pulse | null>(null);
  const [pulse, setPulse] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/home-pulse", { cache: "no-store" });
      if (!res.ok) return;
      setData((await res.json()) as Pulse);
      setPulse(true);
      window.setTimeout(() => setPulse(false), 700);
    } catch {
      /* keep */
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useAutoRefresh(refresh, { intervalMs: 90_000 });

  const m = data?.nextMatch;

  return (
    <div
      className={`home-pulse home-pulse-single${pulse ? " is-live" : ""}`}
      aria-label="Ближайший КВ"
    >
      <div className="home-pulse-item">
        <span className="home-pulse-label">Ближайший КВ</span>
        {m ? (
          <Link className="home-pulse-main" href="/cw" prefetch={false}>
            <span className="home-pulse-vs">
              {hostLabel(m.clan, m.bbHost)}{" "}
              <span className="muted">vs</span> {m.opp}
            </span>
            <span className="home-pulse-meta muted">
              {formatMatchDate(m.day, m.month, m.year)} · {m.timeMsk} МСК
              {m.mapShort ? ` · ${m.mapShort}` : ""}
              {m.stack ? ` · ${m.stack}` : ""}
            </span>
            {m.bbHost && m.forecast ? (
              <span
                className={`home-pulse-chip ${winTone(m.forecast.winPct)}`}
                title={m.forecast.summary}
              >
                win {m.forecast.winPct}%
              </span>
            ) : null}
          </Link>
        ) : (
          <span className="home-pulse-main muted">
            Нет ближайших слотов ·{" "}
            <Link href="/cw-find" prefetch={false}>
              Поиск КВ
            </Link>
          </span>
        )}
      </div>
    </div>
  );
}
