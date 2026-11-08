import { type HomeCwCard } from "@/components/HomeCwAnnounce";
import { HomeHubCwDock } from "@/components/HomeHubCwDock";
import { HomeHubTiles } from "@/components/HomeHubTiles";
import { HOME_HUB_SHOW_TILES, type HomeHubTile } from "@/lib/homeHub";
import type { HubTileLayout } from "@/lib/homeHubLayoutShared";

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
      <header className="mobile-hub-heading">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/blackberry.png" alt="" width={64} height={64} />
        <div><p>BLACKBERRY SQUAD</p><h1>Твой игровой штаб</h1><span>Матчи, команда и твой прогресс</span></div>
      </header>
      <HomeHubCwDock
        showCw={showCw}
        cwCards={cwCards}
        canEdit={canEditTiles}
        initialLayout={tileLayout}
      />

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
