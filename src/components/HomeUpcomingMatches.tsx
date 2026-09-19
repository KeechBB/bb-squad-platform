import Link from "next/link";
import {
  confidenceLabel,
  formatMatchDate,
  type UpcomingMatchPreview,
} from "@/lib/kvForecast";

type Props = {
  previews: UpcomingMatchPreview[];
};

export function HomeUpcomingMatches({ previews }: Props) {
  if (previews.length === 0) {
    return (
      <section className="home-upcoming" aria-label="Предстоящие матчи">
        <header className="home-upcoming-head">
          <p className="eyebrow">КВ</p>
          <h2>Предстоящие матчи</h2>
        </header>
        <p className="muted" style={{ margin: 0 }}>
          Ближайших матчей пока нет. Смотри календарь в{" "}
          <Link href="/cw">клановых войнах</Link>.
        </p>
      </section>
    );
  }

  return (
    <section className="home-upcoming" aria-label="Предстоящие матчи">
      <header className="home-upcoming-head">
        <p className="eyebrow">прогноз ИИ · статистика КВ</p>
        <h2>Предстоящие матчи</h2>
        <p className="muted home-upcoming-lead">
          Превью по карте, составу и истории встреч — оценка шансов BB.
        </p>
      </header>

      <ul className="home-match-list">
        {previews.map((m, i) => {
          const f = m.forecast;
          return (
            <li
              key={m.key}
              className="home-match"
              style={{ animationDelay: `${i * 70}ms` }}
            >
              <div className="home-match-top">
                <div className="home-match-when">
                  <strong>
                    {formatMatchDate(m.day, m.month, m.year)}
                  </strong>
                  <span className="muted">{m.timeMsk} МСК</span>
                </div>
                <div
                  className={`home-match-pct${
                    f.winPct >= 55
                      ? " is-good"
                      : f.winPct <= 42
                        ? " is-bad"
                        : ""
                  }`}
                  title={confidenceLabel(f.confidence)}
                >
                  <span className="home-match-pct-num">{f.winPct}%</span>
                  <span className="home-match-pct-label">победа</span>
                </div>
              </div>

              <div className="home-match-vs">
                <span className="home-match-bb">BB</span>
                <span className="home-match-vs-sep">vs</span>
                <span className="home-match-opp">{m.opp}</span>
              </div>

              <div className="home-match-meta">
                <span>{m.mapShort}</span>
                <span>·</span>
                <span>{m.stack}</span>
                <span>·</span>
                <span>{m.size}</span>
              </div>

              <div
                className="home-match-bar"
                aria-hidden="true"
                title={`W ${f.winPct}% · D ${f.drawPct}% · L ${f.losePct}%`}
              >
                <i style={{ width: `${f.winPct}%` }} className="w" />
                <i style={{ width: `${f.drawPct}%` }} className="d" />
                <i style={{ width: `${f.losePct}%` }} className="l" />
              </div>

              <p className="home-match-summary">{f.summary}</p>

              <ul className="home-match-factors">
                {f.factors.map((fac) => (
                  <li key={fac.label} className={`tone-${fac.tone}`}>
                    <span>{fac.label}</span>
                    <strong>{fac.value}</strong>
                  </li>
                ))}
              </ul>

              {m.note ? (
                <p className="home-match-note muted">Заметка: {m.note}</p>
              ) : null}
            </li>
          );
        })}
      </ul>

      <p className="home-upcoming-foot">
        <Link href="/cw">Открыть календарь КВ →</Link>
      </p>
    </section>
  );
}
