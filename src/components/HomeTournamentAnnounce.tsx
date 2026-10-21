import Link from "next/link";
import {
  ACTIVE_TOURNAMENT,
  FRUIT_STRIKE_LOGO,
  formatTourDay,
  isRegistrationOpen,
} from "@/lib/tournaments";

export function HomeTournamentAnnounce() {
  const t = ACTIVE_TOURNAMENT;
  const open = isRegistrationOpen(t);

  return (
    <Link
      href="/tournaments"
      className="home-tour-announce"
      aria-label={`${t.name} — открыть турниры`}
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
        <p className="home-tour-announce-eyebrow">Турнир · Event #01</p>
        <h2 className="home-tour-announce-title">{t.name}</h2>
        <p className="home-tour-announce-meta">
          Регистрация{" "}
          <strong>
            {formatTourDay(t.regOpenDate)} — {formatTourDay(t.regCloseDate)}
          </strong>
          {" · "}
          игра <strong>{formatTourDay(t.playDate)}</strong>
          {" · "}
          приз <strong>10 000 ₽</strong>
        </p>
        <p className="home-tour-announce-cta">
          {open ? "Регистрация открыта — перейти →" : "Смотреть турнир →"}
        </p>
      </div>
    </Link>
  );
}
