/**
 * Season 2 · Halloween Battle Pass — черновик уровней/наград для скрытого превью.
 * Живой S1 (battlePass.ts) не трогаем.
 */

import type { BpLevel, BpReward } from "@/lib/battlePass";
import { BP_LEVELS } from "@/lib/battlePass";

/** Уровни 1–20 = те же задания, что S1; 21–25 — черновик под Season 2. */
const S2_TAIL: BpLevel[] = [
  {
    level: 21,
    title: "Жатва",
    task: "Сыграть 3 матча (пока открыт этот уровень)",
    hint: "Черновик Season 2 · матч ≥80% времени",
    target: 3,
    unit: "матчей",
  },
  {
    level: 22,
    title: "Тыквенный огонь",
    task: "10 ноков за один матч",
    target: 10,
    unit: "ноков",
  },
  {
    level: 23,
    title: "Ночной рейд",
    task: "Сыграть 5 матчей (пока открыт этот уровень)",
    target: 5,
    unit: "матчей",
  },
  {
    level: 24,
    title: "Безжалостный",
    task: "Победить 2 карты подряд",
    hint: "Черновик · поражение → сброс",
    target: 2,
    unit: "побед",
  },
  {
    level: 25,
    title: "Король сада",
    task: "Закончить матч: >20 убийств, ≥10 ревайвов, 0 TK, 0 смертей",
    target: 1,
    unit: "матч",
  },
];

export const BP_S2_LEVELS: BpLevel[] = [...BP_LEVELS, ...S2_TAIL];

/** Награды Season 2 (финал на L25). */
export const BP_S2_REWARDS: BpReward[] = [
  {
    level: 5,
    id: "hw2-gold-bg",
    name: "Ночной урожай",
    short: "Фон",
    kind: "bg",
    preview:
      "Фон профиля «Ночной урожай»: центр чистый под текст, тыквы, фонари и луна только по краям. Остаётся в списке фонов навсегда",
    hover: "Ночной урожай · Награда за достижение 5 уровня Battle Pass Season 2",
    image: "/bp-halloween/profile-bg-v1.jpg",
  },
  {
    level: 10,
    id: "hw2-nick",
    name: "Фиолетовая готика",
    short: "Стиль ника",
    kind: "nick",
    preview:
      "Фиолетовый объёмный шрифт ника с кислотно-зелёной подсветкой для рейтингов паблика, КВ и тренировок",
    hover: "Фиолетовая готика · Награда за достижение 10 уровня Battle Pass Season 2",
    image: "/bp-halloween/nick-v2.jpg",
  },
  {
    level: 15,
    id: "hw2-ak-patch",
    name: "АК «Тыквенный магазин»",
    short: "Нашивка",
    kind: "customize",
    preview:
      "Нашивка у ника в рейтингах паблика, КВ и тренировок. Ставится и снимается в «Кастомизация профиля»",
    hover:
      "АК «Тыквенный магазин» · Награда за достижение 15 уровня Battle Pass Season 2",
    image: "/bp-halloween/weapon-ak-v2.png",
  },
  {
    level: 25,
    id: "hw2-trophy",
    name: "Кубок «Золотая тыква»",
    short: "Медаль",
    kind: "medal",
    preview:
      "Кубок за полное прохождение Season 2 — финальная награда на полке профиля",
    hover: "Кубок «Золотая тыква» · Награда за прохождение 25 уровней Season 2",
    image: "/bp-halloween/trophy-v1.png",
  },
  {
    level: 25,
    id: "hw2-hook-patch",
    name: "Крюк «Жнец сада»",
    short: "Нашивка",
    kind: "customize",
    preview:
      "Вторая часть финального комплекта L25: нашивка-крюк у ника в рейтингах. Идёт вместе с кубком",
    hover: "Крюк «Жнец сада» · Награда за прохождение 25 уровней Season 2",
    image: "/bp-halloween/knife-hook-v2.png",
  },
];
