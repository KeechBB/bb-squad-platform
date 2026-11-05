import { HomeCwAnnounce, type HomeCwCard } from "@/components/HomeCwAnnounce";
import { HomeHubTiles } from "@/components/HomeHubTiles";
import { HOME_HUB_SHOW_TILES, type HomeHubTile } from "@/lib/homeHub";
import type { HubTileLayout } from "@/lib/homeHubLayout";

type Props = {
  showCw: boolean;
  cwCards: HomeCwCard[];
  canEditTiles: boolean;
  tileLayout: HubTileLayout;
  tiles: HomeHubTile[];
};

export function HomeHub({
  showCw,
  cwCards,
  canEditTiles,
  tileLayout,
  tiles,
}: Props) {
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
          <HomeHubTiles
            tiles={tiles}
            initialLayout={tileLayout}
            canEdit={canEditTiles}
          />
        ) : null}
      </div>
    </div>
  );
}
