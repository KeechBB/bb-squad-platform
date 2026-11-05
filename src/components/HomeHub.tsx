import { type HomeCwCard } from "@/components/HomeCwAnnounce";
import { HomeHubCwDock } from "@/components/HomeHubCwDock";
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
