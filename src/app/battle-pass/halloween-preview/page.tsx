import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSession } from "@/lib/auth";
import { SITE_CREATOR_STEAM_ID } from "@/lib/profileBg";
import { BattlePassClient } from "@/components/BattlePassClient";
import { emptySelfProgress, type BpReward } from "@/lib/battlePass";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/** Выбранные Alex варианты Halloween BP (03.11–30.11.2026). Стиль — живой BP. */
const HALLOWEEN_REWARDS: BpReward[] = [
  {
    level: 5,
    id: "hw2-gold-bg",
    name: "Ночной урожай",
    short: "Фон",
    kind: "bg",
    preview:
      "Фон профиля «Ночной урожай»: центр чистый под текст, тыквы, фонари и луна только по краям. Остаётся в списке фонов навсегда",
    hover: "Ночной урожай · Награда за достижение 5 уровня Battle Pass Halloween",
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
    hover: "Фиолетовая готика · Награда за достижение 10 уровня Battle Pass Halloween",
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
    hover: "АК «Тыквенный магазин» · Награда за достижение 15 уровня Battle Pass Halloween",
    image: "/bp-halloween/weapon-ak-v2.png",
  },
  {
    level: 20,
    id: "hw2-trophy",
    name: "Кубок «Золотая тыква»",
    short: "Медаль",
    kind: "medal",
    preview:
      "Кубок за полное прохождение Halloween Battle Pass — финальная награда на полке профиля",
    hover: "Кубок «Золотая тыква» · Награда за прохождение 20 уровней Battle Pass Halloween",
    image: "/bp-halloween/trophy-v1.png",
  },
  {
    level: 20,
    id: "hw2-hook-patch",
    name: "Крюк «Жнец сада»",
    short: "Нашивка",
    kind: "customize",
    preview:
      "Вторая часть финального комплекта L20: нашивка-крюк у ника в рейтингах. Идёт вместе с кубком",
    hover: "Крюк «Жнец сада» · Награда за прохождение 20 уровней Battle Pass Halloween",
    image: "/bp-halloween/knife-hook-v2.png",
  },
];

export default async function HalloweenBattlePassPreviewPage() {
  const session = await getSession();
  if (!session?.user?.steamId || session.user.steamId !== SITE_CREATOR_STEAM_ID) {
    notFound();
  }

  const nick = session.user.nick || session.user.steamName || "Keech";

  return (
    <BattlePassClient
      selfNick={nick}
      selfName={session.user.name || ""}
      selfAvatarUrl={session.user.avatarUrl || session.user.steamAvatar || null}
      selfProgress={emptySelfProgress(nick)}
      leaderboard={[]}
      statusNote="Скрытое превью Halloween BP · только Keech · задания уровней — черновик текущего сезона"
      scoringEnabled={false}
      seasonOverride={{
        subtitle: "Halloween · Фруктовый Сад",
        startLabel: "03.11.2026",
        endLabel: "30.11.2026",
      }}
      detailBg="/bp-halloween/hero-squad.jpg"
      rewardsOverride={HALLOWEEN_REWARDS}
    />
  );
}
