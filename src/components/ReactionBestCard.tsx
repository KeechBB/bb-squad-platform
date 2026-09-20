import Link from "next/link";
import { formatSec3 } from "@/lib/reaction";

type Props = {
  bestAvgMs: number | null;
  bestLevel?: number | null;
  bestL1?: number | null;
  bestL2?: number | null;
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

export function ReactionBestCard({
  bestAvgMs,
  bestL1,
  bestL2,
  history,
}: Props) {
  return (
    <section className="card reaction-profile-card">
      <div className="reaction-profile-best">
        <p className="eyebrow" style={{ marginBottom: 4 }}>
          реакция
        </p>
        <p className="muted" style={{ margin: 0, fontSize: "0.8rem" }}>
          Лучший средний
        </p>
        <strong className="reaction-profile-num">
          {bestAvgMs != null ? `${formatSec3(bestAvgMs)}` : "—"}
          <span> с</span>
        </strong>
        <div className="reaction-profile-levels muted">
          <span>ур.1: {bestL1 != null ? `${formatSec3(bestL1)} с` : "—"}</span>
          <span>ур.2: {bestL2 != null ? `${formatSec3(bestL2)} с` : "—"}</span>
        </div>
        <Link className="kv-link" href="/aim" style={{ marginTop: 8 }}>
          Тренировка стрельбы →
        </Link>
      </div>
      {history.length > 0 ? (
        <div className="reaction-profile-history">
          <h3>История</h3>
          <ul>
            {history.map((h) => (
              <li key={h.id}>
                <span>
                  {fmtDate(h.createdAt)}
                  {h.level != null ? ` · ур.${h.level}` : ""}
                </span>
                <strong>{formatSec3(h.avgMs)} с</strong>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="muted" style={{ margin: "8px 0 0", fontSize: "0.82rem" }}>
          Пока нет серий — сыграй 10 попыток на вкладке тренировки.
        </p>
      )}
    </section>
  );
}
