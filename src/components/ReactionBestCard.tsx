"use client";

import { useState } from "react";
import Link from "next/link";
import { formatScore, formatSec3 } from "@/lib/reaction";

type Props = {
  bestAvgMs: number | null;
  bestLevel?: number | null;
  bestL1?: number | null;
  bestL2?: number | null;
  bestL3?: number | null;
  history: Array<{
    id: string;
    avgMs: number;
    createdAt: string;
    level?: number;
  }>;
};

function fmtDate(iso: string) {
  try {
    return new Intl.DateTimeFormat("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function formatHistoryValue(level: number | undefined, avgMs: number) {
  if (level === 3) return `${formatScore(avgMs)} оч.`;
  return `${formatSec3(avgMs)} с`;
}

export function ReactionBestCard({ bestL1, bestL2, bestL3, history }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <section className="card reaction-profile-card">
        <div className="reaction-profile-best">
          <p className="eyebrow" style={{ marginBottom: 4 }}>
            реакция
          </p>
          <div className="reaction-profile-levels">
            <div className="reaction-profile-level">
              <span className="muted">1 ур</span>
              <strong>
                {bestL1 != null ? `${formatSec3(bestL1)} с` : "—"}
              </strong>
            </div>
            <div className="reaction-profile-level">
              <span className="muted">2 ур</span>
              <strong>
                {bestL2 != null ? `${formatSec3(bestL2)} с` : "—"}
              </strong>
            </div>
            <div className="reaction-profile-level">
              <span className="muted">3 ур</span>
              <strong>
                {bestL3 != null ? `${formatScore(bestL3)} оч.` : "—"}
              </strong>
            </div>
          </div>
          <div className="reaction-profile-actions">
            {history.length > 0 ? (
              <button
                type="button"
                className="kv-link reaction-history-btn"
                onClick={() => setOpen(true)}
              >
                История →
              </button>
            ) : (
              <span className="muted" style={{ fontSize: "0.78rem" }}>
                Пока нет серий
              </span>
            )}
            <Link className="kv-link" href="/aim">
              Тренировка →
            </Link>
          </div>
        </div>
      </section>

      {open ? (
        <div
          className="reaction-history-modal"
          role="dialog"
          aria-modal="true"
          aria-label="История реакции"
          onClick={() => setOpen(false)}
        >
          <div
            className="reaction-history-dialog card"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="reaction-history-dialog-head">
              <h2>История реакции</h2>
              <button
                type="button"
                className="btn ghost"
                onClick={() => setOpen(false)}
              >
                Закрыть
              </button>
            </div>
            <ul className="reaction-history-dialog-list">
              {history.map((h) => (
                <li key={h.id}>
                  <span>
                    {fmtDate(h.createdAt)}
                    {h.level != null ? ` · ур.${h.level}` : ""}
                  </span>
                  <strong>{formatHistoryValue(h.level, h.avgMs)}</strong>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
    </>
  );
}
