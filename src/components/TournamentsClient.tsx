"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ACTIVE_TOURNAMENT,
  isRegistrationOpen,
  tournamentPhase,
  tournamentTabHref,
  type TournamentTabId,
} from "@/lib/tournaments";
import type { TournamentHubState } from "@/lib/tournamentHubShared";
import { TournamentHubFrame } from "@/components/TournamentHubFrame";
import { TournamentHubIdle } from "@/components/TournamentHubIdle";
import { TournamentChampionHome } from "@/components/TournamentChampionHome";
import { TournamentTeamsTab } from "@/components/TournamentTeamsTab";
import { TournamentPlayerStatsTab } from "@/components/TournamentPlayerStatsTab";
import { TournamentTeamRatingTab } from "@/components/TournamentTeamRatingTab";
import { TournamentMatchHistoryTab } from "@/components/TournamentMatchHistoryTab";
import { TournamentHistoryTab } from "@/components/TournamentHistoryTab";
import { TournamentRegisterPanel } from "@/components/TournamentRegisterPanel";

type Props = {
  viewerNick: string;
  initialTab?: TournamentTabId;
  hub: TournamentHubState;
};

function Placeholder({ children }: { children: ReactNode }) {
  return <p className="tn-placeholder">{children}</p>;
}

function TournamentsHomeTab() {
  const t = ACTIVE_TOURNAMENT;
  const regOpen = isRegistrationOpen(t);
  const phase = tournamentPhase(t);
  const phaseBadge =
    phase === "registration"
      ? "Регистрация открыта"
      : phase === "upcoming"
        ? "Регистрация закрыта · завтра игры"
        : phase === "live"
          ? "Регистрация закрыта · идут игры"
          : "Турнир завершён";

  return (
    <div className="tn-home">
      <div className="tn-home-left">
        <section className="tn-panel tn-announce" aria-label="Анонс турнира">
          <div className="tn-announce-head">
            <h2 className="tn-panel-title">Анонс турнира</h2>
            <p className={`tn-reg-badge${regOpen ? " is-open" : " is-closed"}`}>
              {phaseBadge}
            </p>
          </div>
          <p className="tn-announce-name">{t.name}</p>
          <div className="tn-announce-schedule">
            <h3 className="tn-announce-col-title">Регистрация и даты</h3>
            <ul className="tn-announce-list">
              {t.announceSchedule.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        </section>

        <section className="tn-panel tn-logo-only" aria-label="Логотип турнира">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className="tn-logo"
            src={t.logoSrc}
            alt={t.name}
            width={1024}
            height={1024}
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
                  <button
                    type="button"
                    className="tn-prize-media"
                    aria-label={p.hoverTip || p.label}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      className="tn-prize-img"
                      src={p.imageSrc}
                      alt=""
                      width={240}
                      height={240}
                    />
                    {p.hoverTip ? (
                      <span className="tn-prize-tip" role="tooltip">
                        {p.hoverTip}
                      </span>
                    ) : null}
                  </button>
                ) : null}
                {p.cashBanner ? (
                  <div className="tn-prize-cash" aria-label="Денежный приз">
                    <span className="tn-prize-cash-amount">
                      {p.cashBanner.amount}
                    </span>
                    <span className="tn-prize-cash-note">
                      {p.cashBanner.note}
                    </span>
                  </div>
                ) : null}
                {!p.imageSrc && !p.cashBanner ? (
                  <Placeholder>Состав призов — скоро</Placeholder>
                ) : null}
              </div>
            ))}
          </div>
        </section>

        <section className="tn-panel tn-rules" aria-label="Правила турнира">
          <h2 className="tn-panel-title">
            Правила · регистрация · основные положения
          </h2>
          <div className="tn-rules-body">
            {(t.rules || "")
              .split("\n")
              .filter((line) => line.trim().length > 0)
              .map((line) => {
                const isPrize = /10\s*000|10\s*000\s*₽/.test(line);
                if (!isPrize) {
                  return (
                    <p key={line} className="tn-rules-line">
                      {line}
                    </p>
                  );
                }
                const parts = line.split(/(10\s*000\s*₽)/);
                return (
                  <p key={line} className="tn-rules-line is-prize">
                    {parts.map((part, i) =>
                      /10\s*000\s*₽/.test(part) ? (
                        <strong key={i}>{part}</strong>
                      ) : (
                        <span key={i}>{part}</span>
                      )
                    )}
                  </p>
                );
              })}
          </div>
          <Link
            href={t.bracketHref || "/tournaments/bracket"}
            className="tn-bracket-btn"
            aria-label="Сетка турнира"
          >
            СЕТКА ТУРНИРА
          </Link>
        </section>
      </div>

    </div>
  );
}

export function TournamentsClient({
  viewerNick,
  initialTab = "tournaments",
  hub,
}: Props) {
  const router = useRouter();
  const [tab, setTab] = useState<TournamentTabId>(initialTab);

  const body = useMemo(() => {
    switch (tab) {
      case "tournaments":
        if (hub.surface === "idle") return <TournamentHubIdle kind="tournaments" />;
        if (hub.surface === "champion") {
          return <TournamentChampionHome hub={hub} />;
        }
        return <TournamentsHomeTab />;
      case "teams":
        return <TournamentTeamsTab viewerNick={viewerNick} />;
      case "player-stats":
        return <TournamentPlayerStatsTab />;
      case "team-rating":
        return <TournamentTeamRatingTab />;
      case "match-history":
        return <TournamentMatchHistoryTab />;
      case "cup-history":
        return <TournamentHistoryTab hub={hub} />;
      default:
        return null;
    }
  }, [tab, viewerNick, hub]);

  return (
    <TournamentHubFrame
      active={tab}
      onTab={(id) => {
        setTab(id);
        router.replace(tournamentTabHref(id), { scroll: false });
      }}
    >
      {body}
    </TournamentHubFrame>
  );
}
