import { getSession } from "@/lib/auth";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getMeetingDetail } from "@/lib/crossRating";
import type { StatLine } from "@/lib/crossRating";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Props = { params: Promise<{ id: string }> };

function StatTable({
  title,
  rows,
}: {
  title: string;
  rows: StatLine[];
}) {
  return (
    <div className="cross-rating-side">
      <h3 className="stats-h3">{title}</h3>
      {rows.length === 0 ? (
        <p className="muted" style={{ margin: "8px 0 0" }}>
          Нет данных. Для соперника нужны скрины → `oppR1` / `oppR2`.
        </p>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table cross-rating-table">
            <thead>
              <tr>
                <th>Ник</th>
                <th>RES</th>
                <th>Ноки</th>
                <th>K</th>
                <th>D</th>
                <th>DMG</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.nick}>
                  <td>{p.nick}</td>
                  <td>{p.res}</td>
                  <td>{p.nok}</td>
                  <td>{p.kills}</td>
                  <td>{p.deaths}</td>
                  <td>{p.dmg}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default async function RatingMatchPage({ params }: Props) {
  const session = await getSession();
  if (!session?.user?.steamId) redirect("/");
  if (!session.user.profileComplete) redirect("/register");

  const { id: raw } = await params;
  const id = decodeURIComponent(raw || "").trim();
  const detail = await getMeetingDetail(id);
  if (!detail) notFound();

  return (
    <main className="cross-rating-page">
      <div className="cross-rating-shell">
        <header className="cross-rating-top">
          <div>
            <p className="eyebrow">встреча КВ</p>
            <h1>
              BB [{detail.stack}] vs [{detail.oppTag}]
            </h1>
            <p className="muted" style={{ margin: "6px 0 0", lineHeight: 1.45 }}>
              {String(detail.day).padStart(2, "0")} · {detail.map} ·{" "}
              {detail.size} · {detail.bbWon ? "победа BB" : "поражение BB"} ·{" "}
              {detail.meeting || "—"}
            </p>
          </div>
          <Link
            className="kv-link"
            href={`/rating/clan/${encodeURIComponent(detail.oppKey)}`}
          >
            ← к истории [{detail.oppTag}]
          </Link>
        </header>

        <section className="card cross-rating-panel">
          <div className="profile-kv-summary">
            <div>
              <span className="muted">R1</span>
              <strong>{detail.r1 || "—"}</strong>
            </div>
            <div>
              <span className="muted">R2</span>
              <strong>{detail.r2 || "—"}</strong>
            </div>
            <div>
              <span className="muted">Встреча</span>
              <strong>{detail.meeting || "—"}</strong>
            </div>
            <div>
              <span className="muted">Стек</span>
              <strong>{detail.stack}</strong>
            </div>
          </div>
          {detail.note ? (
            <p className="muted" style={{ marginTop: 12 }}>
              {detail.note}
            </p>
          ) : null}
        </section>

        <section className="card cross-rating-panel" style={{ marginTop: 12 }}>
          <h2 className="stats-h3">Раунд 1</h2>
          <div className="cross-rating-sides">
            <StatTable title="BlackBerry" rows={detail.usR1} />
            <StatTable title={`[${detail.oppTag}]`} rows={detail.oppR1} />
          </div>
        </section>

        <section className="card cross-rating-panel" style={{ marginTop: 12 }}>
          <h2 className="stats-h3">Раунд 2</h2>
          <div className="cross-rating-sides">
            <StatTable title="BlackBerry" rows={detail.usR2} />
            <StatTable title={`[${detail.oppTag}]`} rows={detail.oppR2} />
          </div>
        </section>
      </div>
    </main>
  );
}
