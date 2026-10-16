"use client";

import { useMemo } from "react";
import Link from "next/link";
import {
  formatTierArrow,
  type HomeTierBoardData,
  type HomeTierCandidate,
  type HomeTierTransfer,
} from "@/lib/homeTierBoardUi";

type Props = {
  board: HomeTierBoardData;
  /** Внутри /tm — компактный hero */
  embedded?: boolean;
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
  if (band === "strong") return "сильный ↑";
  if (band === "hard") return "форма ↓";
  if (band === "almost") return "почти";
  if (band === "warn") return "риск";
  return band || "—";
}

function bandTone(band: string, ready?: boolean) {
  if (ready) return "tone-warn";
  if (band === "strong") return "tone-good";
  if (band === "hard") return "tone-bad";
  if (band === "almost" || band === "warn") return "tone-warn";
  return "tone-muted";
}

function fitTone(fit: number | null | undefined, dir: "up" | "down") {
  if (fit == null || Number.isNaN(Number(fit))) return "tone-muted";
  const v = Number(fit);
  if (dir === "up") {
    if (v >= 95) return "tone-good";
    if (v >= 90) return "tone-warn";
    return "tone-muted";
  }
  if (v < 75) return "tone-bad";
  if (v < 85) return "tone-warn";
  return "tone-muted";
}

export function TierFitPageClient({ board, embedded = false }: Props) {
  const transfers = board.transfers || [];
  const candidates = board.candidates || [];
  const holdDays = board.holdDays || 2;

  const sortedCandidates = useMemo(() => {
    return [...candidates].sort((a, b) => {
      if (Boolean(a.ready) !== Boolean(b.ready)) return a.ready ? -1 : 1;
      if (a.dir !== b.dir) return a.dir === "up" ? -1 : 1;
      return (b.fit || 0) - (a.fit || 0);
    });
  }, [candidates]);

  const readyCount = candidates.filter((c) => c.ready).length;
  const upCount = candidates.filter((c) => c.dir === "up").length;
  const downCount = candidates.filter((c) => c.dir === "down").length;

  return (
    <div className={`tier-fit-page${embedded ? " is-embedded" : ""}`}>
      <section className={`hero tier-fit-hero${embedded ? " is-compact" : ""}`}>
        <div>
          <p className="eyebrow">автосистема · Fit</p>
          <h1>Тиры FIT</h1>
          <p className="lead">
            Прозрачный рост: роль с тренировок → Fit% в КВ → зоны цвета → автоперевод.
            Ниже — автодоска; ещё ниже — полный разбор по ролям.
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
            <span>Кандидаты ↑</span>
            <strong className="tone-good">{upCount}</strong>
          </div>
          <div className="tier-fit-stat">
            <span>Кандидаты ↓</span>
            <strong className="tone-bad">{downCount}</strong>
          </div>
          <div className="tier-fit-stat">
            <span>Готовы</span>
            <strong className="tone-warn">{readyCount}</strong>
          </div>
        </div>
      </section>

      <section className="tier-fit-legend" aria-label="Как поднять тир">
        <h2 className="tier-fit-legend-title">Как поднять тир — по шагам</h2>
        <ol className="tier-fit-steps">
          <li>
            <b className="tone-warn">1. Роль</b> — кит, который чаще на{" "}
            <em>залитых тренировках</em> (карточка «Роли» в профиле). По этой роли
            считается Fit.
          </li>
          <li>
            <b className="tone-warn">2. Играй КВ в этой роли</b> — Fit% только из
            клановых войн (тренировки дают роль, не Fit).
          </li>
          <li>
            <b className="tone-good">3. Зелёный · ≥95% к тиру выше</b> — держи{" "}
            {holdDays} дня подряд → авто +1 тир.
          </li>
          <li>
            <b className="tone-warn">4. Жёлтый · 90–95% ↑ или 75–85% ↓</b> — «почти»
            / «риск»: видно в кандидатах, автоперевода нет. Смотри рычаг «что
            качать».
          </li>
          <li>
            <b className="tone-bad">5. Красный · &lt;75% своего тира</b> — {holdDays}{" "}
            дня подряд → авто −1 тир.
          </li>
        </ol>
        <div className="tier-fit-swatches" aria-hidden="true">
          <span className="tier-fit-swatch is-good">↑ зелёный · готов / вверх</span>
          <span className="tier-fit-swatch is-warn">
            ● жёлтый · почти / риск / важно
          </span>
          <span className="tier-fit-swatch is-bad">↓ красный · вниз / слабо</span>
        </div>
        <p className="tier-fit-legend-note muted">
          Мало КВ-раундов (&lt;8) — вниз не двигаем. Детали метрик и доски по ролям —
          в блоке «Детальный разбор» ниже.
        </p>
      </section>

      <div className="tier-fit-panels">
        <section className="card tier-fit-card tier-fit-panel">
          <header className="tier-fit-panel-head">
            <div>
              <h2>Автопереводы</h2>
              <p className="muted tier-fit-sub">
                Уже сработавшие смены · зелёный = вверх, красный = вниз, жёлтый =
                дата
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
              <h2>Очередь автосистемы</h2>
              <p className="muted tier-fit-sub">
                Кто на удержании {holdDays}д · «готов» жёлтым · роль = кит с
                тренировок
              </p>
            </div>
            <span className="tier-fit-count">{candidates.length}</span>
          </header>
          {candidates.length === 0 ? (
            <p className="muted">Нет кандидатов в автоочереди.</p>
          ) : (
            <div className="tier-fit-table-scroll">
              <table className="admin-table tier-fit-table">
                <thead>
                  <tr>
                    <th>Игрок</th>
                    <th>Переход</th>
                    <th>Fit</th>
                    <th>Роль (кит)</th>
                    <th>Статус</th>
                    <th>Дней</th>
                    <th>Готов</th>
                    <th>Рычаг / что качать</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedCandidates.map((row) => (
                    <CandidateTr
                      key={`${row.nick}-${row.dir}-${row.toTier}-${row.band}`}
                      row={row}
                      holdDays={holdDays}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
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

function CandidateTr({
  row,
  holdDays,
}: {
  row: HomeTierCandidate;
  holdDays: number;
}) {
  const dirTone = row.dir === "up" ? "tone-good" : "tone-bad";
  const fitCls = fitTone(row.fit, row.dir);
  const ready = Boolean(row.ready);
  const statusTone = bandTone(row.band, ready);
  const days = row.daysHeld;
  const daysLabel = days == null ? "—" : `${days}/${holdDays}`;
  const daysTone =
    ready || (days != null && days > 0) ? "tone-warn" : "tone-muted";

  return (
    <tr className={`tier-fit-row is-${row.dir}${ready ? " is-ready" : ""}`}>
      <td className={`tier-fit-nick${ready ? " tone-warn" : ""}`}>
        <Link href={`/players/${encodeURIComponent(row.nick)}`}>{row.nick}</Link>
      </td>
      <td className={`tier-fit-em ${dirTone}`}>
        {formatTierArrow(row.fromTier, row.toTier)}
      </td>
      <td className={fitCls}>
        <b>{row.fit.toFixed(1)}%</b>
      </td>
      <td className="tone-warn">{row.role || "—"}</td>
      <td className={statusTone}>{bandLabel(row.band)}</td>
      <td className={daysTone}>{daysLabel}</td>
      <td className={ready ? "tone-warn" : "tone-muted"}>
        {ready ? "да" : "нет"}
      </td>
      <td className="muted">
        {[row.lever, row.note].filter(Boolean).join(" · ") || "—"}
      </td>
    </tr>
  );
}
