import { getSession } from "@/lib/auth";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import {
  buildClanEloBoard,
  clanLogoUrl,
  listMeetingsForClan,
} from "@/lib/crossRating";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Props = { params: Promise<{ key: string }> };

export default async function RatingClanPage({ params }: Props) {
  const session = await getSession();
  if (!session?.user?.steamId) redirect("/");
  if (!session.user.profileComplete) redirect("/register");

  const { key: raw } = await params;
  const key = decodeURIComponent(raw || "").trim();
  if (!key) notFound();

  const [{ clan, meetings }, board] = await Promise.all([
    listMeetingsForClan(key),
    buildClanEloBoard(),
  ]);
  const row = board.rows.find(
    (r) => r.key.toUpperCase() === clan.key.toUpperCase()
  );
  const logo = row?.logoUrl || clanLogoUrl(clan.key);

  return (
    <main className="cross-rating-page">
      <div className="cross-rating-shell">
        <header className="cross-rating-top">
          <div className="cross-clan-detail-head">
            {logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                className="cross-clan-logo cross-clan-logo-lg"
                src={logo}
                alt=""
                width={64}
                height={64}
              />
            ) : (
              <span className="cross-clan-logo-fallback cross-clan-logo-lg">
                {clan.tag.slice(0, 2)}
              </span>
            )}
            <div>
              <p className="eyebrow">история встреч</p>
              <h1>
                [{clan.tag}] {clan.name}
              </h1>
              <p className="muted" style={{ margin: "6px 0 0" }}>
                Elo{" "}
                {row?.elo == null ? (
                  <em>калибровка</em>
                ) : (
                  <strong>{row.elo}</strong>
                )}{" "}
                · {meetings.length} встреч · W–L {row?.wins ?? 0}–{row?.losses ?? 0}
              </p>
            </div>
          </div>
          <Link className="kv-link" href="/rating">
            ← к рейтингу кланов
          </Link>
        </header>

        <section className="card cross-rating-panel">
          {meetings.length === 0 ? (
            <p className="muted">Нет сыгранных встреч с этим кланом.</p>
          ) : (
            <div className="admin-table-wrap cross-rating-table-wrap">
              <table className="admin-table cross-rating-table">
                <thead>
                  <tr>
                    <th>День</th>
                    <th>Стек</th>
                    <th>Карта</th>
                    <th>Размер</th>
                    <th>Счёт</th>
                    <th>R1</th>
                    <th>R2</th>
                    <th>Итог</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {meetings.map((m) => (
                    <tr key={m.matchId}>
                      <td>
                        {String(m.day).padStart(2, "0")}.
                        {(m.month.split("-")[1] || "").padStart(2, "0")}
                      </td>
                      <td>{m.stack}</td>
                      <td title={m.map}>{m.map}</td>
                      <td>{m.size}</td>
                      <td>{m.meeting || "—"}</td>
                      <td>{m.r1 || "—"}</td>
                      <td>{m.r2 || "—"}</td>
                      <td>{m.bbWon ? "победа BB" : "поражение BB"}</td>
                      <td>
                        <Link
                          className="kv-link"
                          href={`/rating/match/${encodeURIComponent(m.matchId)}`}
                        >
                          подробно →
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
