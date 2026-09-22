"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { HomeMvpBoardData, HomeMvpRow } from "@/lib/homeMvp";

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

function MedalChips({ row }: { row: HomeMvpRow }) {
  return (
    <ul className="home-mvp-chips" aria-label="Медали">
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
  rows,
}: {
  title: string;
  href: string;
  rows: HomeMvpRow[];
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

      {rows.length === 0 ? (
        <p className="home-mvp-empty muted">Пока нет медалей</p>
      ) : (
        <ol className="home-mvp-podium">
          {rows.map((row, i) => {
            const place = i + 1;
            return (
              <li
                key={`${title}-${row.nick}`}
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
                <MedalChips row={row} />
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

function emptyBoard(): HomeMvpBoardData {
  return {
    train: [],
    main: [],
    junior: [],
    source: "",
    updatedAt: new Date().toISOString(),
  };
}

export function HomeMvpBoard({ initial }: Props) {
  const [data, setData] = useState<HomeMvpBoardData>(initial || emptyBoard());
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
        <span className="home-mvp-live" title="Обновление примерно раз в 45 секунд">
          <i />
          live
        </span>
      </header>

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
        <span className="home-mvp-legend-hint">
          ресы · килы · боевой счёт за раунд
        </span>
      </p>

      <div className="home-mvp-grid">
        <PodiumCol title="Тренировки" href="/tm" rows={data.train} />
        <PodiumCol title="КВ Main" href="/cw" rows={data.main} />
        <PodiumCol title="КВ Junior" href="/cw" rows={data.junior} />
      </div>
    </section>
  );
}
