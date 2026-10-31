"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import {
  TOURNAMENT_BETS_HREF,
  TOURNAMENT_TABS,
  tournamentTabHref,
  type TournamentTabId,
} from "@/lib/tournaments";

function TabLabel({ label, short }: { label: string; short: string }) {
  return (
    <>
      <span className="tn-tab-full">{label}</span>
      <span className="tn-tab-short">{short}</span>
    </>
  );
}

export function TournamentHubFrame({
  active,
  onTab,
  children,
}: {
  active: TournamentTabId | "bets";
  onTab?: (id: TournamentTabId) => void;
  children: ReactNode;
}) {
  return (
    <main className="tn-page">
      <header className="tn-head">
        <div className="tn-head-text">
          <p className="tn-eyebrow">BlackBerry · турнирный хаб</p>
          <h1>Турниры</h1>
        </div>
      </header>

      <nav className="tn-tabs" aria-label="Разделы турниров">
        {TOURNAMENT_TABS.map((tab) => {
          const on = active === tab.id;
          if (onTab) {
            return (
              <button
                key={tab.id}
                type="button"
                className={`tn-tab${on ? " is-on" : ""}`}
                aria-pressed={on}
                onClick={() => onTab(tab.id)}
              >
                <TabLabel label={tab.label} short={tab.short} />
              </button>
            );
          }
          return (
            <Link
              key={tab.id}
              href={tournamentTabHref(tab.id)}
              className={`tn-tab${on ? " is-on" : ""}`}
              aria-current={on ? "page" : undefined}
            >
              <TabLabel label={tab.label} short={tab.short} />
            </Link>
          );
        })}
        <Link
          href={TOURNAMENT_BETS_HREF}
          className={`tn-tab${active === "bets" ? " is-on" : ""}`}
          aria-current={active === "bets" ? "page" : undefined}
        >
          <TabLabel label="Прогнозы" short="Прогноз" />
        </Link>
      </nav>

      <div className="tn-body">{children}</div>
    </main>
  );
}
