"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  confidenceLabel,
  formatMatchDate,
  type UpcomingMatchPreview,
} from "@/lib/kvForecast";

type Props = {
  previews: UpcomingMatchPreview[];
};

function pctTone(winPct: number) {
  if (winPct >= 55) return "is-good";
  if (winPct <= 42) return "is-bad";
  return "";
}

function WinRing({ pct, tone }: { pct: number; tone: string }) {
  const r = 18;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, pct));
  const dash = (clamped / 100) * c;
  return (
    <div className={`home-winring ${tone}`.trim()} aria-hidden="true">
      <svg viewBox="0 0 44 44" width="44" height="44">
        <circle className="home-winring-track" cx="22" cy="22" r={r} />
        <circle
          className="home-winring-value"
          cx="22"
          cy="22"
          r={r}
          strokeDasharray={`${dash} ${c}`}
          transform="rotate(-90 22 22)"
        />
      </svg>
      <span className="home-winring-num">{pct}%</span>
    </div>
  );
}

export function HomeUpcomingMatches({ previews }: Props) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const selected = useMemo(
    () => previews.find((m) => m.key === selectedKey) || null,
    [previews, selectedKey]
  );

  return (
    <section className="home-ops-board" aria-label="Предстоящие матчи">
      <div className="home-ops-corners" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
      </div>

      <header className="home-ops-head">
        <div>
          <p className="home-ops-eyebrow">прогноз ИИ · КВ</p>
          <h2>Брифинг миссий</h2>
        </div>
        <span className="home-ops-count">
          {previews.length ? `${previews.length}` : "—"}
        </span>
      </header>

      {previews.length === 0 ? (
        <p className="muted home-upcoming-empty">
          Ближайших матчей пока нет.{" "}
          <Link href="/cw">Календарь КВ →</Link>
        </p>
      ) : selected ? (
        <div className="home-match-detail">
          <button
            type="button"
            className="home-match-back"
            onClick={() => setSelectedKey(null)}
          >
            ← К брифингу
          </button>

          <div className="home-match-detail-top">
            <div>
              <p className="home-match-detail-when muted">
                {formatMatchDate(selected.day, selected.month, selected.year)} ·{" "}
                {selected.timeMsk} МСК
              </p>
              <h3 className="home-match-detail-vs">
                <span className="home-match-bb">BB</span>
                <span className="home-match-vs-sep">vs</span>
                <span className="home-match-opp">{selected.opp}</span>
              </h3>
              <p className="home-match-meta">
                {selected.map} · {selected.stack} · {selected.size}
              </p>
            </div>
            <WinRing
              pct={selected.forecast.winPct}
              tone={pctTone(selected.forecast.winPct)}
            />
          </div>

          <div
            className="home-match-bar"
            aria-hidden="true"
            title={`W ${selected.forecast.winPct}% · D ${selected.forecast.drawPct}% · L ${selected.forecast.losePct}%`}
          >
            <i
              style={{ width: `${selected.forecast.winPct}%` }}
              className="w"
            />
            <i
              style={{ width: `${selected.forecast.drawPct}%` }}
              className="d"
            />
            <i
              style={{ width: `${selected.forecast.losePct}%` }}
              className="l"
            />
          </div>

          <p className="home-match-confidence muted">
            {confidenceLabel(selected.forecast.confidence)}
          </p>
          <p className="home-match-summary">{selected.forecast.summary}</p>

          <ul className="home-match-factors">
            {selected.forecast.factors.map((fac) => (
              <li key={fac.label} className={`tone-${fac.tone}`}>
                <span>{fac.label}</span>
                <strong>{fac.value}</strong>
              </li>
            ))}
          </ul>

          {selected.note ? (
            <p className="home-match-note muted">Заметка: {selected.note}</p>
          ) : null}
        </div>
      ) : (
        <>
          <ul className="home-mission-list">
            {previews.map((m, idx) => {
              const f = m.forecast;
              const tone = pctTone(f.winPct);
              return (
                <li key={m.key}>
                  <button
                    type="button"
                    className="home-mission"
                    onClick={() => setSelectedKey(m.key)}
                  >
                    <span className="home-mission-rail" aria-hidden="true">
                      <span className="home-mission-dot" />
                      {idx < previews.length - 1 ? (
                        <span className="home-mission-line" />
                      ) : null}
                    </span>

                    <span className="home-mission-when">
                      <strong>
                        {String(m.day).padStart(2, "0")}.
                        {String(m.month).padStart(2, "0")}
                      </strong>
                      <em>{m.timeMsk}</em>
                    </span>

                    <span className="home-mission-body">
                      <span className="home-mission-vs">
                        <span className="home-match-bb">BB</span>
                        <span className="home-mission-vs-sep">—</span>
                        <span>{m.opp}</span>
                      </span>
                      <span className="home-mission-map" title={m.map}>
                        {m.map}
                      </span>
                      <span className="home-mission-tags">
                        <span>{m.stack}</span>
                        <span>{m.size}</span>
                      </span>
                    </span>

                    <WinRing pct={f.winPct} tone={tone} />
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="home-upcoming-foot">
            <Link href="/cw">Календарь КВ →</Link>
          </p>
        </>
      )}
    </section>
  );
}
