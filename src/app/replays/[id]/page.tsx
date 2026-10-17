import Link from "next/link";
import { notFound } from "next/navigation";
import { getSession } from "@/lib/auth";
import { isBuiltinSuperAdmin } from "@/lib/admin";
import { ReplayViewer } from "@/components/ReplayViewer";
import { formatDuration, getReplay } from "@/lib/replays";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

export default async function ReplayDetailPage({ params }: Props) {
  const session = await getSession();
  // Beta: только Keech. Остальным — как будто раздела нет.
  if (!isBuiltinSuperAdmin(session?.user?.steamId)) notFound();

  const { id } = await params;
  const data = getReplay(id);
  if (!data) notFound();

  return (
    <main className="replay-page">
      <header className="replay-page-head">
        <Link href="/replays" className="replay-back">
          ← Реплеи
        </Link>
        <h1>{data.title || data.layer}</h1>
        <p>
          {data.server || "TR1"} · {data.layer} · {formatDuration(data.duration_ms)}
          {data.recordedAt ? ` · ${data.recordedAt}` : ""}
        </p>
      </header>
      <ReplayViewer data={data} />
    </main>
  );
}
