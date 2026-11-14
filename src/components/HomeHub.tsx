import { type HomeCwCard } from "@/components/HomeCwAnnounce";
import { HomeEventDay } from "@/components/HomeEventDay";
import { HomeHubCwDock } from "@/components/HomeHubCwDock";
import { HomeHubTiles } from "@/components/HomeHubTiles";
import { HOME_HUB_SHOW_TILES, type HomeHubTile } from "@/lib/homeHub";
import type { HubTileLayout } from "@/lib/homeHubLayoutShared";
import type { EventDayProgress } from "@/lib/eventDay";

type Props = {
  showCw: boolean;
  cwCards: HomeCwCard[];
  canEditTiles: boolean;
  tileLayout: HubTileLayout;
  tiles: HomeHubTile[];
  eventDay: EventDayProgress;
  eventDayLoggedIn: boolean;
};

export function HomeHub({
  showCw,
  cwCards,
  canEditTiles,
  tileLayout,
  tiles,
  eventDay,
  eventDayLoggedIn,
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

      <HomeEventDay progress={eventDay} loggedIn={eventDayLoggedIn} />

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
