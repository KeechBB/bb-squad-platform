import Link from "next/link";
import { HomeCwAnnounce, type HomeCwCard } from "@/components/HomeCwAnnounce";
import { HOME_HUB_SHOW_TILES, HOME_HUB_TILES } from "@/lib/homeHub";

type Props = {
  showCw: boolean;
  cwCards: HomeCwCard[];
};

export function HomeHub({ showCw, cwCards }: Props) {
  return (
    <div className="home-hub" aria-label="Разделы платформы">
      <aside className="home-hub-cw" aria-label="Превью клановых войн">
        {showCw ? (
          <HomeCwAnnounce cards={cwCards} />
        ) : (
          <div className="home-hub-cw-stubs">
            {["КВ Junior", "КВ основа", "КВ весь клан"].map((title) => (
              <section key={title} className="home-hub-cw-stub">
                <p className="home-hub-cw-stub-title">{title}</p>
                <p className="home-hub-cw-stub-meta">дата · время</p>
                <p className="home-hub-cw-stub-meta">против кого · карта</p>
                <div className="home-hub-cw-stub-actions">
                  <button type="button" className="home-hub-cw-stub-btn" disabled>
                    кто в составе
                  </button>
                  <button type="button" className="home-hub-cw-stub-btn" disabled>
                    буду на КВ
                  </button>
                  <button type="button" className="home-hub-cw-stub-btn" disabled>
                    прогноз
                  </button>
                </div>
                <p className="home-hub-cw-stub-dev">заглушка «в разработке»</p>
              </section>
            ))}
          </div>
        )}
      </aside>

      <div className="home-hub-poly">
        {HOME_HUB_SHOW_TILES ? (
          <nav className="home-hub-grid" aria-label="Быстрые разделы">
            {HOME_HUB_TILES.map((tile) => (
              <Link
                key={tile.id}
                href={tile.href}
                className={`home-hub-tile home-hub-tile--${tile.id}`}
                title={tile.title}
                aria-label={tile.title}
              >
                <span className="home-hub-tile-plate" aria-hidden="true" />
                <span
                  className="home-hub-tile-art"
                  aria-hidden="true"
                  style={{ backgroundImage: `url(${tile.image}?v=hex1)` }}
                />
              </Link>
            ))}
          </nav>
        ) : null}
      </div>
    </div>
  );
}
