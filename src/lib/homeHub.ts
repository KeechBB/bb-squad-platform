/** Home hub rebrand. Set false to restore classic homepage. */
export const HOME_HUB_REBRAND = true;

/**
 * Hub background: `public/home-hub/hub-poly-empty-shell.jpg`
 * Empty hex slots shell (gold octagon). Sections hidden until cells land.
 */
export const HOME_HUB_BG_FILE = "/home-hub/hub-poly-empty-shell.jpg";

/** All 9 section tiles on hub. Positions: data/home-hub-tile-layout.json */
export const HOME_HUB_SHOW_TILES = true;

export type HomeHubTile = {
  id: string;
  title: string;
  /** Large readable caption on the tile (yellow). */
  label: string;
  image: string;
  /** Real route or WIP stub. */
  href: string;
  stub?: boolean;
};

/** 3×3 grid: mid-right = marketplace, bottom-right = faction. */
export const HOME_HUB_TILES: HomeHubTile[] = [
  {
    id: "tournaments",
    title: "Турниры",
    label: "ТУРНИРЫ",
    image: "/home-hub/tournaments.png",
    href: "/tournaments",
  },
  {
    id: "public",
    title: "Рейтинг паблика",
    label: "РЕЙТИНГ\nПАБЛИКА",
    image: "/home-hub/public-rating.png",
    href: "/public",
  },
  {
    id: "cw",
    title: "Клановые войны",
    label: "КЛАНОВЫЕ\nВОЙНЫ",
    image: "/home-hub/clan-wars.png",
    href: "/cw",
  },
  {
    id: "training",
    title: "Тренировка BlackBerry",
    label: "ТРЕНИРОВКА",
    image: "/home-hub/training.png",
    href: "/tm",
  },
  {
    id: "battle-pass",
    title: "Battle Pass",
    label: "BATTLE PASS",
    image: "/home-hub/battle-pass.png",
    href: "/battle-pass",
  },
  {
    id: "marketplace",
    title: "Торговая Площадка",
    label: "ТОРГОВАЯ\nПЛОЩАДКА",
    image: "/home-hub/marketplace.png",
    href: "/wip/marketplace",
    stub: true,
  },
  {
    id: "my-clan",
    title: "Мой клан",
    label: "МОЙ КЛАН",
    image: "/home-hub/my-clan.png",
    href: "/clans",
  },
  {
    id: "my-team",
    title: "Моя команда",
    label: "МОЯ\nКОМАНДА",
    image: "/home-hub/my-team.png",
    href: "/wip/team",
    stub: true,
  },
  {
    id: "my-faction",
    title: "Моя фракция",
    label: "МОЯ\nФРАКЦИЯ",
    image: "/home-hub/my-faction.png",
    href: "/wip/faction",
    stub: true,
  },
];

export const HOME_HUB_WIP_TITLES: Record<string, string> = {
  marketplace: "Торговая Площадка",
  team: "Моя команда",
  faction: "Моя фракция",
};
