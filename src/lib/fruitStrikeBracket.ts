/** Зафиксированная сетка Fruit Strike на 8 слотов. Имена команд ещё не подставлены. */

export type BracketCard = {
  winner: string;
  loser: string;
  score: string;
};

export const FRUIT_STRIKE_PLACES = [
  { place: "1", team: "Team 1" },
  { place: "2", team: "Team 2" },
  { place: "3", team: "Team 4" },
] as const;

export const FRUIT_STRIKE_WINNERS = {
  quarters: [
    { winner: "Team 1", loser: "Team 8", score: "2:0" },
    { winner: "Team 4", loser: "Team 5", score: "2:1" },
    { winner: "Team 2", loser: "Team 7", score: "2:0" },
    { winner: "Team 6", loser: "Team 3", score: "2:1" },
  ],
  semis: [
    { winner: "Team 1", loser: "Team 4", score: "2:1" },
    { winner: "Team 2", loser: "Team 6", score: "2:0" },
  ],
  final: { winner: "Team 1", loser: "Team 2", score: "2:1" },
} satisfies {
  quarters: BracketCard[];
  semis: BracketCard[];
  final: BracketCard;
};

export const FRUIT_STRIKE_LOSERS = {
  round1: [
    { winner: "Team 8", loser: "Team 5", score: "2:0" },
    { winner: "Team 7", loser: "Team 3", score: "2:1" },
  ],
  round2: [
    { winner: "Team 6", loser: "Team 8", score: "2:0", drop: "Team 6" },
    { winner: "Team 4", loser: "Team 7", score: "2:1", drop: "Team 4" },
  ],
  semi: { winner: "Team 4", loser: "Team 6", score: "2:0" },
  final: { winner: "Team 2", loser: "Team 4", score: "2:1", drop: "Team 2" },
} as const;

export const FRUIT_STRIKE_GRAND = {
  winner: "Team 1",
  loser: "Team 2",
  score: "2:0",
} as const;
