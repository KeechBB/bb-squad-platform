import Link from "next/link";
import { formatMs3 } from "@/lib/reaction";

type Props = {
  bestAvgMs: number | null;
  history: Array<{ id: string; avgMs: number; createdAt: string }>;
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

export function ReactionBestCard({ bestAvgMs, history }: Props) {
  return (
    <section className="card reaction-profile-card">
      <div className="reaction-profile-best">
        <p className="eyebrow" style={{ marginBottom: 4 }}>
          реакция · ур. 1
        </p>
        <p className="muted" style={{ margin: 0, fontSize: "0.8rem" }}>
          Лучший средний
        </p>
        <strong className="reaction-profile-num">
          {bestAvgMs != null ? `${formatMs3(bestAvgMs)}` : "—"}
          <span> мс</span>
        </strong>
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
                <span>{fmtDate(h.createdAt)}</span>
                <strong>{formatMs3(h.avgMs)} мс</strong>
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
