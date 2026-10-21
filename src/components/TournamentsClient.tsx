"use client";

import { useMemo, useState, type ReactNode } from "react";
import {
  ACTIVE_TOURNAMENT,
  TOURNAMENT_TABS,
  type TournamentTabId,
} from "@/lib/tournaments";
import { TournamentTeamsTab } from "@/components/TournamentTeamsTab";

type Props = {
  viewerNick: string;
};

function Placeholder({ children }: { children: ReactNode }) {
  return <p className="tour-placeholder">{children}</p>;
}

function TournamentsHomeTab() {
  const t = ACTIVE_TOURNAMENT;

  function onBracket() {
    if (t.bracketHref) {
      window.location.href = t.bracketHref;
      return;
    }
    // Сетка ещё не залита — визуальная кнопка уже живая
  }

  return (
    <div className="tn-home">
      <div className="tn-home-left">
        <section className="tn-panel tn-announce" aria-label="Анонс турнира">
          <h2 className="tn-panel-title">Анонс турнира</h2>
          {t.announce ? (
            <div className="tn-announce-body">{t.announce}</div>
          ) : (
            <Placeholder>
              Здесь появятся даты турнира, окна регистрации и ключевые сроки.
              Пока раздел в подготовке.
            </Placeholder>
          )}
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

        <section
          className="tn-panel tn-register"
          aria-label="Регистрация команды"
        >
          <h2 className="tn-panel-title">Регистрация команды на турнир</h2>
          <Placeholder>
            Доступна только капитанам команд (не кланов), собравших нужный
            состав. Форма заявки появится после открытия регистрации.
          </Placeholder>
          <button
            type="button"
            className="tn-register-btn"
            disabled={!t.registrationOpen}
            title={
              t.registrationOpen
                ? "Подать заявку"
                : "Регистрация ещё не открыта"
            }
          >
            {t.registrationOpen ? "Подать заявку" : "Регистрация закрыта"}
          </button>
        </section>
      </div>

      <div className="tn-home-right">
        <section className="tn-panel tn-prizes" aria-label="Награды за турнир">
          <h2 className="tn-panel-title">Награды за турнир</h2>
          <div className="tn-prizes-grid">
            {t.prizes.map((p) => (
              <div key={p.place} className={`tn-prize place-${p.place}`}>
                <h3>{p.label}</h3>
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
          {t.rules ? (
            <div className="tn-rules-body">{t.rules}</div>
          ) : (
            <Placeholder>
              Здесь будут формат, карты, моды и регламент. Текст ещё
              готовится.
            </Placeholder>
          )}
          <button
            type="button"
            className="tn-bracket-btn"
            onClick={onBracket}
            aria-label="Сетка турнира"
          >
            СЕТКА ТУРНИРА
          </button>
          {!t.bracketHref ? (
            <p className="tn-bracket-hint">Кнопка живая · сетка появится позже</p>
          ) : null}
        </section>
      </div>
    </div>
  );
}

function ComingSoonTab({ title }: { title: string }) {
  return (
    <section className="tn-soon" aria-label={title}>
      <h2>{title}</h2>
      <Placeholder>
        Вкладка в разработке. Сетка и логика уже заложены — контент добавим
        следом.
      </Placeholder>
    </section>
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
        return <ComingSoonTab title="Статистика игроков" />;
      case "team-rating":
        return <ComingSoonTab title="Рейтинг команд" />;
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
            Черновик раздела · видно только тебе ({viewerNick || "Keech"})
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
