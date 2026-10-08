"use client";

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

export function TierFitPageClient({ board }: Props) {
  const transfers = board.transfers || [];
  const candidates = board.candidates || [];
  const ups = candidates.filter((c) => c.dir === "up");
  const downs = candidates.filter((c) => c.dir === "down");

  return (
    <main className="tier-fit-page">
      <section className="hero tier-fit-hero">
        <div>
          <p className="eyebrow">автосистема · Fit КВ</p>
          <h1>Тиры FIT</h1>
          <p className="lead">
            Переводы и кандидаты по Fit (% от эталона тира по роли на КВ). Порог:
            ≥95% вверх / &lt;75% вниз · {board.holdDays || 2} дня подряд.
          </p>
        </div>
        <div className="tier-fit-meta">
          <div className="tier-fit-stat">
            <span>Обновлено</span>
            <strong>{fmtDate(board.updatedAt)}</strong>
          </div>
          <div className="tier-fit-stat">
            <span>Переводы</span>
            <strong>{transfers.length}</strong>
          </div>
          <div className="tier-fit-stat">
            <span>Кандидаты</span>
            <strong>{candidates.length}</strong>
          </div>
        </div>
      </section>

      <section className="card tier-fit-card">
        <h2>Переводы</h2>
        <p className="muted tier-fit-sub">
          Уже сработавшие смены тира (автономно по Fit).
        </p>
        {transfers.length === 0 ? (
          <p className="muted">Пока нет переводов.</p>
        ) : (
          <div className="admin-table-wrap">
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
                  <TransferTr key={`${row.nick}-${row.at}-${row.toTier}`} row={row} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="tier-fit-grid">
        <section className="card tier-fit-card">
          <h2>Кандидаты ↑</h2>
          <p className="muted tier-fit-sub">На повышение (высокий Fit).</p>
          <CandidatesTable rows={ups} empty="Нет кандидатов на повышение." />
        </section>
        <section className="card tier-fit-card">
          <h2>Кандидаты ↓</h2>
          <p className="muted tier-fit-sub">На понижение (низкий Fit).</p>
          <CandidatesTable rows={downs} empty="Нет кандидатов на понижение." />
        </section>
      </div>
    </main>
  );
}

function TransferTr({ row }: { row: HomeTierTransfer }) {
  const tone = row.dir === "up" ? "is-up" : "is-down";
  return (
    <tr className={`tier-fit-row ${tone}`}>
      <td>
        <Link href={`/players/${encodeURIComponent(row.nick)}`}>{row.nick}</Link>
      </td>
      <td>{formatTierArrow(row.fromTier, row.toTier)}</td>
      <td>{row.dir === "up" ? "↑ вверх" : "↓ вниз"}</td>
      <td>{row.fit == null ? "—" : `${Number(row.fit).toFixed(1)}%`}</td>
      <td>{fmtDate(row.at)}</td>
      <td className="muted">{row.note || "—"}</td>
    </tr>
  );
}

function CandidatesTable({
  rows,
  empty,
}: {
  rows: HomeTierCandidate[];
  empty: string;
}) {
  if (rows.length === 0) {
    return <p className="muted">{empty}</p>;
  }
  return (
    <div className="admin-table-wrap">
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
          {rows.map((row) => {
            const tone = row.dir === "down" ? "is-down" : "is-up";
            return (
              <tr
                key={`${row.nick}-${row.dir}-${row.toTier}-${row.band}`}
                className={`tier-fit-row ${tone}`}
              >
                <td>
                  <Link href={`/players/${encodeURIComponent(row.nick)}`}>
                    {row.nick}
                  </Link>
                </td>
                <td>{formatTierArrow(row.fromTier, row.toTier)}</td>
                <td>
                  <b>{row.fit.toFixed(1)}%</b>
                </td>
                <td>{row.role || "—"}</td>
                <td>{bandLabel(row.band)}</td>
                <td>{row.daysHeld ?? "—"}</td>
                <td>{row.ready ? "да" : "нет"}</td>
                <td className="muted">
                  {[row.lever, row.note].filter(Boolean).join(" · ") || "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
