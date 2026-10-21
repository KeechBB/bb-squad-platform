"use client";

import { useMemo, useState, type ReactNode } from "react";
import {
  ACTIVE_TOURNAMENT,
  TOURNAMENT_TABS,
  isRegistrationOpen,
  type TournamentTabId,
} from "@/lib/tournaments";
import { TournamentTeamsTab } from "@/components/TournamentTeamsTab";
import { TournamentPlayerStatsTab } from "@/components/TournamentPlayerStatsTab";
import { TournamentTeamRatingTab } from "@/components/TournamentTeamRatingTab";
import { TournamentMatchHistoryTab } from "@/components/TournamentMatchHistoryTab";
import { TournamentRegisterPanel } from "@/components/TournamentRegisterPanel";

type Props = {
  viewerNick: string;
};

function Placeholder({ children }: { children: ReactNode }) {
  return <p className="tn-placeholder">{children}</p>;
}

function TournamentsHomeTab() {
  const t = ACTIVE_TOURNAMENT;
  const regOpen = isRegistrationOpen(t);

  function onBracket() {
    if (t.bracketHref) {
      window.location.href = t.bracketHref;
      return;
    }
  }

  return (
    <div className="tn-home">
      <div className="tn-home-left">
        <section className="tn-panel tn-announce" aria-label="Анонс турнира">
          <h2 className="tn-panel-title">Анонс турнира</h2>
          <p className="tn-announce-name">{t.name}</p>
          <div className="tn-announce-cols">
            <div className="tn-announce-col">
              <h3 className="tn-announce-col-title">Регистрация и даты</h3>
              <ul className="tn-announce-list">
                {t.announceSchedule.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
            <div className="tn-announce-col">
              <h3 className="tn-announce-col-title">Формат</h3>
              <ul className="tn-announce-list">
                {t.announceFormat.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          </div>
          <p className={`tn-reg-badge${regOpen ? " is-open" : ""}`}>
            {regOpen ? "Регистрация открыта" : "Регистрация закрыта"}
          </p>
        </section>

        <section className="tn-panel tn-logo-only" aria-label="Логотип турнира">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className="tn-logo"
            src={t.logoSrc}
            alt={t.name}
            width={1024}
            height={1005}
            decoding="async"
          />
        </section>

        <TournamentRegisterPanel />
      </div>

      <div className="tn-home-right">
        <section className="tn-panel tn-prizes" aria-label="Награды за турнир">
          <h2 className="tn-panel-title">Награды за турнир</h2>
          <div className="tn-prizes-grid">
            {t.prizes.map((p) => (
              <div key={p.place} className={`tn-prize place-${p.place}`}>
                <h3>{p.label}</h3>
                {p.imageSrc ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    className="tn-prize-img"
                    src={p.imageSrc}
                    alt=""
                    width={220}
                    height={220}
                  />
                ) : null}
                {p.items.length ? (
                  <ul>
                    {p.items.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                ) : (
                  <Placeholder>Состав призов — скоро</Placeholder>
                )}
              </div>
            ))}
          </div>
        </section>

        <section className="tn-panel tn-rules" aria-label="Правила турнира">
          <h2 className="tn-panel-title">
            Правила · регистрация · основные положения
          </h2>
          <div className="tn-rules-body">{t.rules}</div>
          <button
            type="button"
            className="tn-bracket-btn"
            onClick={onBracket}
            aria-label="Сетка турнира"
          >
            СЕТКА ТУРНИРА
          </button>
          {!t.bracketHref ? (
            <p className="tn-bracket-hint">
              Сетка заполнится зарегистрированными командами · карты — за 5 дней
              до конца регистрации
            </p>
          ) : null}
        </section>
      </div>
    </div>
  );
}

export function TournamentsClient({ viewerNick }: Props) {
  const [tab, setTab] = useState<TournamentTabId>("tournaments");

  const body = useMemo(() => {
    switch (tab) {
      case "tournaments":
        return <TournamentsHomeTab />;
      case "teams":
        return <TournamentTeamsTab viewerNick={viewerNick} />;
      case "player-stats":
        return <TournamentPlayerStatsTab />;
      case "team-rating":
        return <TournamentTeamRatingTab />;
      case "match-history":
        return <TournamentMatchHistoryTab />;
      default:
        return null;
    }
  }, [tab, viewerNick]);

  return (
    <main className="tn-page">
      <header className="tn-head">
        <div className="tn-head-text">
          <p className="tn-eyebrow">BlackBerry · турнирный хаб</p>
          <h1>Турниры</h1>
          <p className="tn-sub">
            {ACTIVE_TOURNAMENT.name} · видно только тебе ({viewerNick || "Keech"})
          </p>
        </div>
      </header>

      <nav className="tn-tabs" aria-label="Разделы турниров">
        {TOURNAMENT_TABS.map((t) => {
          const on = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              className={`tn-tab${on ? " is-on" : ""}`}
              aria-pressed={on}
              onClick={() => setTab(t.id)}
            >
              <span className="tn-tab-full">{t.label}</span>
              <span className="tn-tab-short">{t.short}</span>
            </button>
          );
        })}
      </nav>

      <div className="tn-body">{body}</div>
    </main>
  );
}
