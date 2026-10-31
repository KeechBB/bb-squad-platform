"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import {
  TOURNAMENT_BETS_HREF,
  TOURNAMENT_HISTORY_TAB,
  TOURNAMENT_PRIMARY_TABS,
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
  function primaryTab(tab: (typeof TOURNAMENT_PRIMARY_TABS)[number]) {
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
  }

  const hist = TOURNAMENT_HISTORY_TAB;
  const histOn = active === hist.id;

  return (
    <main className="tn-page">
      <header className="tn-head">
        <div className="tn-head-text">
          <p className="tn-eyebrow">BlackBerry · турнирный хаб</p>
          <h1>Турниры</h1>
        </div>
      </header>

      <nav className="tn-tabs" aria-label="Разделы турниров">
        {TOURNAMENT_PRIMARY_TABS.map(primaryTab)}
        <Link
          href={TOURNAMENT_BETS_HREF}
          className={`tn-tab${active === "bets" ? " is-on" : ""}`}
          aria-current={active === "bets" ? "page" : undefined}
        >
          <TabLabel label="Прогнозы" short="Прогноз" />
        </Link>
        {onTab ? (
          <button
            type="button"
            className={`tn-tab${histOn ? " is-on" : ""}`}
            aria-pressed={histOn}
            onClick={() => onTab(hist.id)}
          >
            <TabLabel label={hist.label} short={hist.short} />
          </button>
        ) : (
          <Link
            href={tournamentTabHref(hist.id)}
            className={`tn-tab${histOn ? " is-on" : ""}`}
            aria-current={histOn ? "page" : undefined}
          >
            <TabLabel label={hist.label} short={hist.short} />
          </Link>
        )}
      </nav>

      <div className="tn-body">{children}</div>
    </main>
  );
}
