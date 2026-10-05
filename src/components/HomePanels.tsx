"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { HomeTrainPwrTop } from "@/components/HomeTrainPwrTop";
import { HomeTierBoard } from "@/components/HomeTierBoard";
import type { HomeTrainPwrBoard } from "@/lib/homeTrainPwr";
import type { HomeTierBoardData } from "@/lib/homeTierBoardUi";

export type HomePublicTopRow = {
  nick: string;
  rp: number;
  rankLabel: string;
  rankKey: string;
};

type Panel = "train" | "public" | "tiers";

type Props = {
  pwrBoard: HomeTrainPwrBoard;
  publicTop: HomePublicTopRow[];
  tierBoard: HomeTierBoardData;
};

const BUTTONS: { id: Panel; label: string; tone: string }[] = [
  { id: "train", label: "Top 10 Тренировки", tone: "is-train" },
  { id: "public", label: "Топ 10 паблика", tone: "is-public" },
  { id: "tiers", label: "Тиры", tone: "is-tiers" },
];

export function HomePanels({ pwrBoard, publicTop, tierBoard }: Props) {
  const [open, setOpen] = useState<Panel | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <div className="home-dock" role="tablist" aria-label="Сводки главной">
        {BUTTONS.map((b) => (
          <button
            key={b.id}
            type="button"
            role="tab"
            aria-selected={open === b.id}
            className={`home-dock-btn ${b.tone}${open === b.id ? " is-on" : ""}`}
            onClick={() => setOpen(open === b.id ? null : b.id)}
          >
            {b.label}
          </button>
        ))}
      </div>

      {open ? (
        <div className="home-overlay" role="dialog" aria-modal="true">
          <button
            type="button"
            className="home-overlay-back"
            aria-label="Закрыть"
            onClick={() => setOpen(null)}
          />
          <div className="home-overlay-card">
            <button
              type="button"
              className="home-overlay-x"
              onClick={() => setOpen(null)}
            >
              закрыть
            </button>
            {open === "train" ? <HomeTrainPwrTop initial={pwrBoard} /> : null}
            {open === "public" ? <PublicTop rows={publicTop} /> : null}
            {open === "tiers" ? <HomeTierBoard initial={tierBoard} /> : null}
          </div>
        </div>
      ) : null}
    </>
  );
}

function PublicTop({ rows }: { rows: HomePublicTopRow[] }) {
  return (
    <div className="home-attend-streaks home-train-pwr" aria-label="Топ паблика">
      <div className="home-attend-streaks-head">
        <p className="home-attend-streaks-title">Паблик · ТОП 10</p>
        <p className="home-attend-streaks-sub muted">RP публичных матчей</p>
      </div>
      {rows.length === 0 ? (
        <p className="home-attend-streaks-empty muted">Пока нет статы</p>
      ) : (
        <ol className="home-attend-streaks-list home-train-pwr-list">
          {rows.map((r, i) => (
            <li
              key={r.nick}
              className={`home-attend-streaks-row home-train-pwr-row${i === 0 ? " is-top1" : ""}`}
            >
              <span className="home-attend-streaks-rank">{i + 1}</span>
              <span className={`home-pwr-badge rank-${r.rankKey}`} title={r.rankLabel}>
                {r.rankLabel}
              </span>
              <Link
                className={`home-attend-streaks-nick${i === 0 ? " home-pwr-nick-top1" : ""}`}
                href={`/players/${encodeURIComponent(r.nick)}`}
                title={r.nick}
              >
                {r.nick}
              </Link>
              <span className="home-attend-streaks-days home-train-pwr-score">
                <b>{Math.round(Number(r.rp) || 0)}</b>
                <span>RP</span>
              </span>
            </li>
          ))}
        </ol>
      )}
      <p className="home-train-pwr-foot muted">
        <Link href="/public">Полный рейтинг →</Link>
      </p>
    </div>
  );
}
