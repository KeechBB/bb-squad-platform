"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  emptyHomeMvpBoard,
  type HomeMvpBoardData,
  type HomeMvpLane,
  type HomeMvpRow,
} from "@/lib/homeMvp";

type Props = {
  initial: HomeMvpBoardData;
};

const POLL_MS = 45_000;

function medalWord(n: number) {
  const m = Math.abs(n) % 100;
  const m1 = m % 10;
  if (m > 10 && m < 20) return "медалей";
  if (m1 === 1) return "медаль";
  if (m1 >= 2 && m1 <= 4) return "медали";
  return "медалей";
}

function GloryChips({ row }: { row: HomeMvpRow }) {
  return (
    <ul className="home-mvp-chips" aria-label="MVP медали">
      {row.medic > 0 ? (
        <li
          className="home-mvp-chip home-mvp-chip-medic"
          title="Medic — больше всех ресов за раунд"
        >
          <span className="home-mvp-chip-label">Medic</span>
          <span className="home-mvp-chip-n">×{row.medic}</span>
        </li>
      ) : null}
      {row.killer > 0 ? (
        <li
          className="home-mvp-chip home-mvp-chip-killer"
          title="Killer — больше всех килов за раунд"
        >
          <span className="home-mvp-chip-label">Killer</span>
          <span className="home-mvp-chip-n">×{row.killer}</span>
        </li>
      ) : null}
      {row.war > 0 ? (
        <li
          className="home-mvp-chip home-mvp-chip-war"
          title="War-Score — выше всех боевой счёт за раунд"
        >
          <span className="home-mvp-chip-label">War</span>
          <span className="home-mvp-chip-n">×{row.war}</span>
        </li>
      ) : null}
    </ul>
  );
}

function PodiumCol({
  title,
  href,
  lane,
}: {
  title: string;
  href: string;
  lane: HomeMvpLane;
}) {
  return (
    <div className="home-mvp-col">
      <div className="home-mvp-col-head">
        <span>{title}</span>
        <Link
          href={href}
          className="home-mvp-col-link"
          aria-label={`Открыть ${title}`}
        >
          →
        </Link>
      </div>

      {lane.glory.length === 0 ? (
        <p className="home-mvp-empty muted">Пока нет MVP</p>
      ) : (
        <ol className="home-mvp-podium">
          {lane.glory.map((row, i) => {
            const place = i + 1;
            return (
              <li
                key={`${title}-g-${row.nick}`}
                className={`home-mvp-step home-mvp-step-${place}`}
              >
                <div className="home-mvp-step-top">
                  <span className="home-mvp-step-crown" aria-hidden="true">
                    {place === 1 ? "★" : place}
                  </span>
                  <div className="home-mvp-step-who">
                    <p className="home-mvp-step-nick" title={row.nick}>
                      {row.nick}
                    </p>
                    <p className="home-mvp-step-total">
                      <b>{row.medals}</b>
                      <span>{medalWord(row.medals)}</span>
                    </p>
                  </div>
                </div>
                <GloryChips row={row} />
              </li>
            );
          })}
        </ol>
      )}

      <div className="home-mvp-anti-block">
        <p className="home-mvp-anti-head">Anti-MVP</p>
        {lane.anti.length === 0 ? (
          <p className="home-mvp-empty muted">Пока чисто</p>
        ) : (
          <ol className="home-mvp-anti-list">
            {lane.anti.map((row) => (
              <li key={`${title}-a-${row.nick}`} className="home-mvp-anti-row">
                <span className="home-mvp-anti-nick" title={row.nick}>
                  {row.nick}
                </span>
                <span
                  className="home-mvp-chip home-mvp-chip-anti"
                  title="Anti-MVP — больше всех смертей за раунд"
                >
                  <span className="home-mvp-chip-label">Anti</span>
                  <span className="home-mvp-chip-n">×{row.anti}</span>
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

export function HomeMvpBoard({ initial }: Props) {
  const [data, setData] = useState<HomeMvpBoardData>(
    initial || emptyHomeMvpBoard()
  );
  const [pulse, setPulse] = useState(false);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const res = await fetch("/api/home-mvp", { cache: "no-store" });
        if (!res.ok || !alive) return;
        const next = (await res.json()) as HomeMvpBoardData;
        if (!alive) return;
        setData((prev) => {
          const changed =
            JSON.stringify({
              t: prev.train,
              m: prev.main,
              j: prev.junior,
            }) !==
            JSON.stringify({
              t: next.train,
              m: next.main,
              j: next.junior,
            });
          if (changed) {
            setPulse(true);
            window.setTimeout(() => setPulse(false), 900);
          }
          return next;
        });
      } catch {
        /* keep last */
      }
    };
    const id = window.setInterval(tick, POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);

  return (
    <section
      className={`home-ops-board home-mvp-board${pulse ? " home-mvp-pulse" : ""}`}
      aria-label="MVP пьедестал"
    >
      <div className="home-ops-corners" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
      </div>

      <header className="home-ops-head">
        <div>
          <p className="home-ops-eyebrow">пьедестал · live</p>
          <h2>MVP рекорды</h2>
        </div>
        <span
          className="home-mvp-live"
          title="Обновление примерно раз в 45 секунд"
        >
          <i />
          live
        </span>
      </header>

      <div className="home-mvp-legend-wrap">
        <p className="home-mvp-legend">
          <span className="home-mvp-chip home-mvp-chip-medic">
            <span className="home-mvp-chip-label">Medic</span>
          </span>
          <span className="home-mvp-chip home-mvp-chip-killer">
            <span className="home-mvp-chip-label">Killer</span>
          </span>
          <span className="home-mvp-chip home-mvp-chip-war">
            <span className="home-mvp-chip-label">War</span>
          </span>
          <span className="home-mvp-legend-hint">ресы · килы · боевой счёт</span>
        </p>
        <p className="home-mvp-legend home-mvp-legend-anti">
          <span className="home-mvp-chip home-mvp-chip-anti">
            <span className="home-mvp-chip-label">Anti-MVP</span>
          </span>
          <span className="home-mvp-legend-hint">смерти · отдельно от MVP</span>
        </p>
      </div>

      <div className="home-mvp-grid">
        <PodiumCol title="Тренировки" href="/tm" lane={data.train} />
        <PodiumCol title="КВ Main" href="/cw" lane={data.main} />
        <PodiumCol title="КВ Junior" href="/cw" lane={data.junior} />
      </div>
    </section>
  );
}
