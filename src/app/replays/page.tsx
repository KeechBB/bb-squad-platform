import Link from "next/link";
import { notFound } from "next/navigation";
import { getSession } from "@/lib/auth";
import { isBuiltinSuperAdmin } from "@/lib/admin";
import { formatDuration, listReplays } from "@/lib/replays";

export const dynamic = "force-dynamic";

export default async function ReplaysPage() {
  const session = await getSession();
  // Beta: только Keech. Остальным — как будто раздела нет.
  if (!isBuiltinSuperAdmin(session?.user?.steamId)) notFound();

  const matches = listReplays();

  return (
    <main className="replay-index">
      <header className="replay-index-head">
        <h1>Реплеи</h1>
        <p>Свои записи TR1 → plaza → viewer. Без squadreader.com.</p>
      </header>
      {matches.length === 0 ? (
        <p className="replay-empty">Пока нет залитых реплеев.</p>
      ) : (
        <ul className="replay-index-list">
          {matches.map((m) => (
            <li key={m.id}>
              <Link href={`/replays/${m.id}`} className="replay-index-card">
                <strong>{m.title || m.layer}</strong>
                <span>
                  {m.server || "TR1"} · {formatDuration(m.duration_ms)} ·{" "}
                  {m.tracks_players} трек
                  {m.tracks_players === 1 ? "" : "а"}
                </span>
                <span className="replay-muted">
                  {(m.players || []).join(", ") || "—"}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
