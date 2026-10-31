import Link from "next/link";
import type { TournamentHubState } from "@/lib/tournamentHubShared";
import { ACTIVE_TOURNAMENT } from "@/lib/tournaments";

export function TournamentChampionHome({ hub }: { hub: TournamentHubState }) {
  const t = ACTIVE_TOURNAMENT;
  const champ = hub.champion;

  return (
    <div className="tn-home tn-home-champion">
      <div className="tn-home-left">
        <section className="tn-panel tn-announce" aria-label="Итоги турнира">
          <div className="tn-announce-head">
            <h2 className="tn-panel-title">Итоги турнира</h2>
            <p className="tn-reg-badge is-champion">Чемпион определён</p>
          </div>
          <p className="tn-announce-name">{hub.tournamentName}</p>
          <div className="tn-announce-schedule">
            <h3 className="tn-announce-col-title">Итоги</h3>
            <ul className="tn-announce-list">
              <li>Игры: {hub.playDateLabel}</li>
              <li>Подведение итогов: {hub.resultsDateLabel}</li>
              {hub.championWindowEndsAt ? (
                <li>
                  Анонс чемпиона на хабе до конца окна (МСК · следующий день)
                </li>
              ) : null}
            </ul>
          </div>
          {champ ? (
            <div className="tn-champ-card">
              {champ.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  className="tn-champ-logo"
                  src={champ.logoUrl}
                  alt=""
                  width={160}
                  height={160}
                />
              ) : (
                <div className="tn-champ-logo is-empty" aria-hidden />
              )}
              <div className="tn-champ-copy">
                <p className="tn-champ-eyebrow">Чемпион</p>
                <p className="tn-champ-name">
                  [{champ.tag}] {champ.name}
                </p>
              </div>
            </div>
          ) : null}
          {hub.places.length ? (
            <ol className="tn-podium">
              {hub.places.map((p) => (
                <li key={p.place} className={`tn-podium-row place-${p.place}`}>
                  <span className="tn-podium-place">{p.place}</span>
                  <span className="tn-podium-team">
                    [{p.tag}] {p.name}
                  </span>
                </li>
              ))}
            </ol>
          ) : null}
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
      </div>

      <div className="tn-home-right">
        <section className="tn-panel tn-prizes" aria-label="Награды">
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
                    width={240}
                    height={240}
                  />
                ) : null}
                {p.cashBanner ? (
                  <div className="tn-prize-cash">
                    <span className="tn-prize-cash-amount">
                      {p.cashBanner.amount}
                    </span>
                    <span className="tn-prize-cash-note">{p.cashBanner.note}</span>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </section>
        <section className="tn-panel" aria-label="Сетка">
          <h2 className="tn-panel-title">Итоговая сетка</h2>
          <p className="tn-idle-hint">
            Полная сетка и ход команд — в истории турниров и на странице сетки.
          </p>
          <Link
            href={t.bracketHref || "/tournaments/bracket"}
            className="tn-bracket-btn"
          >
            СЕТКА ТУРНИРА
          </Link>
        </section>
      </div>
    </div>
  );
}
