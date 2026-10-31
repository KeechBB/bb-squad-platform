"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  ACTIVE_TOURNAMENT,
  FRUIT_STRIKE_LOGO,
  tournamentHomeCta,
  tournamentHomeStatusLine,
  tournamentPhase,
} from "@/lib/tournaments";
import {
  grandFinalDone,
  resolveHubSurface,
  type HubSurface,
} from "@/lib/tournamentHubShared";
import type { FruitLiveState } from "@/lib/fruitStrikeLiveView";

export function HomeTournamentAnnounce() {
  const t = ACTIVE_TOURNAMENT;
  const [now, setNow] = useState(() => new Date());
  const [surface, setSurface] = useState<HubSurface>("active");
  const [champLabel, setChampLabel] = useState<string | null>(null);

  useEffect(() => {
    const tick = () => setNow(new Date());
    const id = window.setInterval(tick, 30_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/tournaments/live", { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const live = (await res.json()) as FruitLiveState;
        if (cancelled) return;
        const next = resolveHubSurface({ live, now: new Date(), tournament: t });
        setSurface(next);
        const gf = grandFinalDone(live);
        if (gf?.winner) {
          const tag = gf.winner.tag || "";
          const name = gf.winner.name || tag;
          setChampLabel(tag ? `[${tag}] ${name}` : name);
        } else {
          setChampLabel(null);
        }
      } catch {
        /* keep active fallback */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [t]);

  if (surface === "idle") return null;

  const phase = tournamentPhase(t, now);
  const status =
    surface === "champion" && champLabel
      ? {
          lead: "Чемпион",
          emphasis: champLabel,
          rest: `· итоги ${t.resultsDate.slice(8)}.${t.resultsDate.slice(5, 7)}.${t.resultsDate.slice(2, 4)}`,
        }
      : tournamentHomeStatusLine(t, now);
  const cta =
    surface === "champion"
      ? "Смотреть итоги турнира →"
      : tournamentHomeCta(t, now);
  const href =
    surface === "champion"
      ? "/tournaments"
      : phase === "registration"
        ? "/tournaments"
        : "/tournaments/bracket";

  return (
    <Link
      href={href}
      className={`home-tour-announce${phase !== "registration" || surface === "champion" ? " is-closed" : ""}`}
      aria-label={`${t.name} — ${cta}`}
    >
      <div className="home-tour-announce-logo-wrap">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          className="home-tour-announce-logo"
          src={FRUIT_STRIKE_LOGO}
          alt=""
          width={220}
          height={220}
        />
      </div>
      <div className="home-tour-announce-body">
        <p className="home-tour-announce-eyebrow">
          {surface === "champion" ? "Итоги турнира" : "Турнир · Event #01"}
        </p>
        <h2 className="home-tour-announce-title">{t.name}</h2>
        <p className="home-tour-announce-meta">
          {status.lead} <strong>{status.emphasis}</strong>
          {status.rest ? ` ${status.rest}` : ""}
        </p>
        <p className="home-tour-announce-cta">{cta}</p>
      </div>
    </Link>
  );
}
