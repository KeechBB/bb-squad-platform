/** Home hub rebrand. Set false to restore classic homepage. */
export const HOME_HUB_REBRAND = true;

export type HomeHubTile = {
  id: string;
  title: string;
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
    image: "/home-hub/tournaments.png",
    href: "/tournaments",
  },
  {
    id: "public",
    title: "Рейтинг паблика",
    image: "/home-hub/public-rating.png",
    href: "/public",
  },
  {
    id: "cw",
    title: "Клановые войны",
    image: "/home-hub/clan-wars.png",
    href: "/cw",
  },
  {
    id: "training",
    title: "Тренировка BlackBerry",
    image: "/home-hub/training.png",
    href: "/tm",
  },
  {
    id: "battle-pass",
    title: "Battle Pass",
    image: "/home-hub/battle-pass.png",
    href: "/battle-pass",
  },
  {
    id: "marketplace",
    title: "Торговая Площадка",
    image: "/home-hub/marketplace.png",
    href: "/wip/marketplace",
    stub: true,
  },
  {
    id: "my-clan",
    title: "Мой клан",
    image: "/home-hub/my-clan.png",
    href: "/clans",
  },
  {
    id: "my-team",
    title: "Моя команда",
    image: "/home-hub/my-team.png",
    href: "/wip/team",
    stub: true,
  },
  {
    id: "my-faction",
    title: "Моя фракция",
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
