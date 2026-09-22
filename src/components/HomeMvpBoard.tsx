import Link from "next/link";
import type { HomeMvpBoardData, HomeMvpRow } from "@/lib/homeMvp";

type Props = {
  data: HomeMvpBoardData;
};

function MvpCol({
  title,
  href,
  rows,
}: {
  title: string;
  href: string;
  rows: HomeMvpRow[];
}) {
  return (
    <div className="home-mvp-col">
      <div className="home-mvp-col-head">
        <span>{title}</span>
        <Link href={href} className="home-mvp-col-link">
          →
        </Link>
      </div>
      {rows.length === 0 ? (
        <p className="home-mvp-empty muted">Пока нет</p>
      ) : (
        <ol className="home-mvp-list">
          {rows.map((row, i) => (
            <li key={`${title}-${row.nick}`} className="home-mvp-row">
              <span className="home-mvp-rank" aria-hidden="true">
                {i + 1}
              </span>
              <span className="home-mvp-nick" title={row.nick}>
                {row.nick}
              </span>
              <span className="home-mvp-medals" title="Medic / Killer / War-Score">
                <b>{row.medals}</b>
                <em>
                  {row.medic}/{row.killer}/{row.war}
                </em>
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export function HomeMvpBoard({ data }: Props) {
  return (
    <section className="home-ops-board home-mvp-board" aria-label="MVP рекорды">
      <div className="home-ops-corners" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
      </div>

      <header className="home-ops-head">
        <div>
          <p className="home-ops-eyebrow">медали · рекорды</p>
          <h2>MVP рекорды</h2>
        </div>
        <span className="home-ops-count" title="Тренировки + КВ">
          8
        </span>
      </header>

      <div className="home-mvp-grid">
        <MvpCol title="Тренировки" href="/tm" rows={data.train} />
        <MvpCol title="КВ" href="/cw" rows={data.kv} />
      </div>
    </section>
  );
}
