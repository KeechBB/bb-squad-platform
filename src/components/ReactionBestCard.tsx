import Link from "next/link";
import { formatScore, formatSec3 } from "@/lib/reaction";

type Props = {
  bestAvgMs?: number | null;
  bestLevel?: number | null;
  bestL1?: number | null;
  bestL2?: number | null;
  history?: Array<{
    id: string;
    avgMs: number;
    createdAt: string;
    level?: number;
  }>;
};

export function ReactionBestCard({ bestL1, bestL2 }: Props) {
  return (
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
              {bestL2 != null ? `${formatScore(bestL2)} оч.` : "—"}
            </strong>
          </div>
        </div>
        <div className="reaction-profile-actions">
          <Link className="kv-link" href="/aim">
            Тренировка →
          </Link>
        </div>
      </div>
    </section>
  );
}
