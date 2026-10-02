import Link from "next/link";
import {
  formatTierArrow,
  type HomeTierBoardData,
  type HomeTierCandidate,
  type HomeTierTransfer,
} from "@/lib/homeTierBoard";

type Props = {
  initial: HomeTierBoardData;
};

function TransferRow({ row }: { row: HomeTierTransfer }) {
  const tone = row.dir === "up" ? "is-up" : "is-down";
  return (
    <li className={`home-tier-row ${tone}`}>
      <div className="home-tier-row-main">
        <Link className="home-tier-nick" href={`/players/${encodeURIComponent(row.nick)}`}>
          {row.nick}
        </Link>
        <span className="home-tier-move">{formatTierArrow(row.fromTier, row.toTier)}</span>
      </div>
      {row.note ? <p className="home-tier-note">{row.note}</p> : null}
    </li>
  );
}

function CandidateRow({ row }: { row: HomeTierCandidate }) {
  const tone =
    row.band === "strong" || row.band === "hard"
      ? "is-hold"
      : row.dir === "down"
        ? "is-warn"
        : "is-almost";
  return (
    <li className={`home-tier-row ${tone}`}>
      <div className="home-tier-row-main">
        <Link className="home-tier-nick" href={`/players/${encodeURIComponent(row.nick)}`}>
          {row.nick}
        </Link>
        <span className="home-tier-move">{formatTierArrow(row.fromTier, row.toTier)}</span>
        <span className="home-tier-fit">{row.fit.toFixed(1)}%</span>
      </div>
      {row.note ? <p className="home-tier-note">{row.note}</p> : null}
    </li>
  );
}

export function HomeTierBoard({ initial }: Props) {
  const transfers = initial.transfers || [];
  const candidates = initial.candidates || [];
  const empty = transfers.length === 0 && candidates.length === 0;

  return (
    <section className="home-ops-board home-tier-board" aria-label="Автосистема тиров">
      <div className="home-ops-corners" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
      </div>

      <header className="home-ops-head">
        <div>
          <p className="home-ops-eyebrow">авто · Fit КВ</p>
          <h2>Тиры</h2>
        </div>
        <span className="home-ops-count">
          {transfers.length + candidates.length > 0
            ? String(transfers.length + candidates.length)
            : "—"}
        </span>
      </header>

      {empty ? (
        <p className="muted home-tier-empty">Пока тихо — ждём Fit / КВ.</p>
      ) : (
        <div className="home-tier-body">
          {transfers.length > 0 ? (
            <div className="home-tier-block">
              <h3 className="home-tier-block-title">Переводы</h3>
              <ul className="home-tier-list">
                {transfers.map((row) => (
                  <TransferRow
                    key={`${row.nick}-${row.at}-${row.fromTier}-${row.toTier}`}
                    row={row}
                  />
                ))}
              </ul>
            </div>
          ) : null}

          {candidates.length > 0 ? (
            <div className="home-tier-block">
              <h3 className="home-tier-block-title">Кандидаты</h3>
              <ul className="home-tier-list">
                {candidates.slice(0, 12).map((row) => (
                  <CandidateRow
                    key={`${row.nick}-${row.dir}-${row.toTier}-${row.band}`}
                    row={row}
                  />
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
