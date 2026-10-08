"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  formatTierArrow,
  type HomeTierBoardData,
  type HomeTierCandidate,
  type HomeTierTransfer,
} from "@/lib/homeTierBoardUi";

type Props = {
  board: HomeTierBoardData;
};

type TabId = "train";

const TABS: { id: TabId; label: string }[] = [
  { id: "train", label: "Тренировочные матчи" },
];

function fmtDate(iso: string) {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat("ru-RU", {
      timeZone: "Europe/Moscow",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso.slice(0, 16);
  }
}

function bandLabel(band: string) {
  if (band === "strong" || band === "hard") return "удержание";
  if (band === "almost") return "почти";
  if (band === "ready") return "готов";
  return band || "—";
}

function fitTone(fit: number | null | undefined, dir: "up" | "down") {
  if (fit == null || Number.isNaN(Number(fit))) return "tone-muted";
  const v = Number(fit);
  if (dir === "up") {
    if (v >= 95) return "tone-good";
    if (v >= 85) return "tone-warn";
    return "tone-muted";
  }
  if (v < 75) return "tone-bad";
  if (v < 85) return "tone-warn";
  return "tone-muted";
}

export function TierFitPageClient({ board }: Props) {
  const [tab, setTab] = useState<TabId>("train");
  const transfers = board.transfers || [];
  const candidates = board.candidates || [];

  const sortedCandidates = useMemo(() => {
    return [...candidates].sort((a, b) => {
      if (Boolean(a.ready) !== Boolean(b.ready)) return a.ready ? -1 : 1;
      if (a.dir !== b.dir) return a.dir === "up" ? -1 : 1;
      return (b.fit || 0) - (a.fit || 0);
    });
  }, [candidates]);

  return (
    <main className="tier-fit-page">
      <section className="hero tier-fit-hero">
        <div>
          <p className="eyebrow">автосистема · Fit</p>
          <h1>Тиры FIT</h1>
          <p className="lead">
            Переводы и кандидаты по Fit (% от эталона тира по роли). Порог: ≥95%
            вверх / &lt;75% вниз · {board.holdDays || 2} дня подряд.
          </p>
        </div>
        <div className="tier-fit-meta">
          <div className="tier-fit-stat">
            <span>Обновлено</span>
            <strong>{fmtDate(board.updatedAt)}</strong>
          </div>
          <div className="tier-fit-stat">
            <span>Переводы</span>
            <strong className="tone-warn">{transfers.length}</strong>
          </div>
          <div className="tier-fit-stat">
            <span>Кандидаты</span>
            <strong>{candidates.length}</strong>
          </div>
        </div>
      </section>

      <nav className="tier-fit-tabs" aria-label="Разделы Тиры FIT">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`tier-fit-tab${tab === t.id ? " is-active" : ""}`}
            aria-pressed={tab === t.id}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {tab === "train" ? (
        <TrainMatchesTab
          transfers={transfers}
          candidates={sortedCandidates}
        />
      ) : null}
    </main>
  );
}

function TrainMatchesTab({
  transfers,
  candidates,
}: {
  transfers: HomeTierTransfer[];
  candidates: HomeTierCandidate[];
}) {
  return (
    <div className="tier-fit-panels">
      <section className="card tier-fit-card tier-fit-panel">
        <header className="tier-fit-panel-head">
          <div>
            <h2>Переводы</h2>
            <p className="muted tier-fit-sub">
              Уже сработавшие смены тира · жёлтый = важно, зелёный = вверх,
              красный = вниз
            </p>
          </div>
          <span className="tier-fit-count tone-warn">{transfers.length}</span>
        </header>
        {transfers.length === 0 ? (
          <p className="muted">Пока нет переводов.</p>
        ) : (
          <div className="tier-fit-table-scroll">
            <table className="admin-table tier-fit-table">
              <thead>
                <tr>
                  <th>Игрок</th>
                  <th>Переход</th>
                  <th>Направление</th>
                  <th>Fit</th>
                  <th>Когда (МСК)</th>
                  <th>Заметка</th>
                </tr>
              </thead>
              <tbody>
                {transfers.map((row) => (
                  <TransferTr
                    key={`${row.nick}-${row.at}-${row.toTier}`}
                    row={row}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card tier-fit-card tier-fit-panel">
        <header className="tier-fit-panel-head">
          <div>
            <h2>Кандидаты</h2>
            <p className="muted tier-fit-sub">
              Повышение и понижение в одной таблице · «готов» — жёлтым
            </p>
          </div>
          <span className="tier-fit-count">{candidates.length}</span>
        </header>
        {candidates.length === 0 ? (
          <p className="muted">Нет кандидатов.</p>
        ) : (
          <div className="tier-fit-table-scroll">
            <table className="admin-table tier-fit-table">
              <thead>
                <tr>
                  <th>Игрок</th>
                  <th>Переход</th>
                  <th>Fit</th>
                  <th>Роль</th>
                  <th>Статус</th>
                  <th>Дней</th>
                  <th>Готов</th>
                  <th>Рычаг / заметка</th>
                </tr>
              </thead>
              <tbody>
                {candidates.map((row) => (
                  <CandidateTr
                    key={`${row.nick}-${row.dir}-${row.toTier}-${row.band}`}
                    row={row}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function TransferTr({ row }: { row: HomeTierTransfer }) {
  const dirTone = row.dir === "up" ? "tone-good" : "tone-bad";
  const fitCls = fitTone(row.fit, row.dir);
  return (
    <tr className={`tier-fit-row is-${row.dir}`}>
      <td className="tier-fit-nick">
        <Link href={`/players/${encodeURIComponent(row.nick)}`}>{row.nick}</Link>
      </td>
      <td className={`tier-fit-em ${dirTone}`}>
        {formatTierArrow(row.fromTier, row.toTier)}
      </td>
      <td className={dirTone}>{row.dir === "up" ? "↑ вверх" : "↓ вниз"}</td>
      <td className={fitCls}>
        {row.fit == null ? "—" : `${Number(row.fit).toFixed(1)}%`}
      </td>
      <td className="tone-warn">{fmtDate(row.at)}</td>
      <td className="muted">{row.note || "—"}</td>
    </tr>
  );
}

function CandidateTr({ row }: { row: HomeTierCandidate }) {
  const dirTone = row.dir === "up" ? "tone-good" : "tone-bad";
  const fitCls = fitTone(row.fit, row.dir);
  const ready = Boolean(row.ready);
  return (
    <tr
      className={`tier-fit-row is-${row.dir}${ready ? " is-ready" : ""}`}
    >
      <td className={`tier-fit-nick${ready ? " tone-warn" : ""}`}>
        <Link href={`/players/${encodeURIComponent(row.nick)}`}>{row.nick}</Link>
      </td>
      <td className={`tier-fit-em ${dirTone}`}>
        {formatTierArrow(row.fromTier, row.toTier)}
      </td>
      <td className={fitCls}>
        <b>{row.fit.toFixed(1)}%</b>
      </td>
      <td>{row.role || "—"}</td>
      <td className={ready ? "tone-warn" : undefined}>{bandLabel(row.band)}</td>
      <td>{row.daysHeld ?? "—"}</td>
      <td className={ready ? "tone-warn" : "tone-muted"}>
        {ready ? "да" : "нет"}
      </td>
      <td className="muted">
        {[row.lever, row.note].filter(Boolean).join(" · ") || "—"}
      </td>
    </tr>
  );
}
