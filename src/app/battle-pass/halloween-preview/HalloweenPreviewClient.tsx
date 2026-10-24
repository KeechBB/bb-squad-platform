"use client";

import { useMemo, useState } from "react";
import { BP_LEVELS } from "@/lib/battlePass";
import styles from "./HalloweenPreview.module.css";

type Reward = {
  level: number;
  name: string;
  kind: string;
  kindLabel: string;
  text: string;
  img: string;
  media: "bg" | "nick" | "patch" | "trophy";
};

const REWARDS: Reward[] = [
  {
    level: 5,
    name: "Ночной урожай",
    kind: "Фон профиля",
    kindLabel: "Фон",
    text: "Центр чистый под текст профиля, контент только по краям: тыквы, фонари, луна и туман Фруктового сада.",
    img: "/bp-halloween/profile-bg-v1.jpg",
    media: "bg",
  },
  {
    level: 10,
    name: "Фиолетовая готика",
    kind: "Стиль ника",
    kindLabel: "Ник",
    text: "Фиолетовый объёмный шрифт с кислотно-зелёной внутренней подсветкой. В рейтингах будет CSS-эффектом, тут — утверждённый арт-образец.",
    img: "/bp-halloween/nick-v2.jpg",
    media: "nick",
  },
  {
    level: 15,
    name: "АК «Тыквенный магазин»",
    kind: "Нашивка у ника",
    kindLabel: "Нашивка",
    text: "Фиолетово-чёрный АК с тыквенным магазином и токсичным свечением. Прозрачная нашивка 1000×283, как положено по канону.",
    img: "/bp-halloween/weapon-ak-v2.png",
    media: "patch",
  },
  {
    level: 20,
    name: "Кубок «Золотая тыква»",
    kind: "Медаль на полку профиля",
    kindLabel: "Кубок",
    text: "Финальная награда за полное прохождение сезона: золотая тыква-кубок с зелёным ядром и фиолетовыми камнями.",
    img: "/bp-halloween/trophy-v1.png",
    media: "trophy",
  },
  {
    level: 20,
    name: "Крюк «Жнец сада»",
    kind: "Нашивка у ника · комплект L20",
    kindLabel: "Крюк",
    text: "Вторая часть финального комплекта L20: серп-крюк с фиолетовым клинком и зелёной кромкой. Идёт вместе с кубком.",
    img: "/bp-halloween/knife-hook-v2.png",
    media: "patch",
  },
];

function rewardFor(level: number) {
  return REWARDS.filter((r) => r.level === level);
}

export function HalloweenPreviewClient({ selfNick }: { selfNick: string }) {
  const [selected, setSelected] = useState(20);
  const level = useMemo(
    () => BP_LEVELS.find((l) => l.level === selected) || BP_LEVELS[0],
    [selected],
  );
  const levelRewards = rewardFor(selected);
  const nick = selfNick || "Keech";

  return (
    <main className={styles.page}>
      <header className={styles.hero}>
        <p className={styles.eyebrow}>Halloween · Фруктовый сад · Сезон 2</p>
        <h1 className={styles.title}>Battle Pass</h1>
        <p className={styles.dates}>03.11.2026 — 30.11.2026</p>
        <p className={styles.note}>
          Скрытое превью следующего сезона: как будет выглядеть страница,
          награды и главный баннер. Задания уровней пока взяты из текущего
          сезона как черновик.
        </p>
        <div className={styles.badges}>
          <span className={`${styles.badge} ${styles.badgeOrange}`}>Тыквенный оранжевый</span>
          <span className={`${styles.badge} ${styles.badgeGreen}`}>Токсично-зелёный</span>
          <span className={`${styles.badge} ${styles.badgeViolet}`}>Глубокий фиолетовый</span>
          <span className={`${styles.badge} ${styles.badgeLock}`}>Доступ: только Keech</span>
        </div>
      </header>

      <section className={styles.trackWrap} aria-label="Уровни Halloween Battle Pass">
        <div className={styles.track}>
          {BP_LEVELS.map((l) => {
            const rewards = rewardFor(l.level);
            const has = rewards.length > 0;
            return (
              <button
                key={l.level}
                type="button"
                className={[
                  styles.node,
                  selected === l.level ? styles.nodeSelected : "",
                  has ? styles.nodeReward : "",
                ].filter(Boolean).join(" ")}
                onClick={() => setSelected(l.level)}
              >
                <span className={styles.nodeRewardTag}>{has ? rewards[0].kindLabel : ""}</span>
                <span className={styles.nodeNum}>{l.level}</span>
                <span className={styles.nodeLabel}>{l.title}</span>
              </button>
            );
          })}
        </div>
      </section>

      <div className={styles.body}>
        <section className={styles.detail} aria-live="polite">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className={styles.detailImg} src="/bp-halloween/hero-squad.jpg" alt="" />
          <div className={styles.detailVeil} aria-hidden />
          <div className={styles.detailContent}>
            <span className={styles.levelTag}>Уровень {level.level}</span>
            <h2 className={styles.detailTitle}>{level.title}</h2>
            <p className={styles.detailTask}>{level.task}</p>
            {levelRewards.map((r) => (
              <div key={r.name} className={styles.rewardStrip}>
                <span>Награда · {r.kind}</span>
                <strong>{r.name}</strong>
                <p>{r.text}</p>
              </div>
            ))}
          </div>
        </section>

        <aside className={styles.side}>
          <h3 className={styles.sideTitle}>Награды сезона · выбранные варианты</h3>
          <div className={styles.gallery}>
            {REWARDS.map((r) => (
              <button
                key={r.name}
                type="button"
                className={`${styles.card} ${selected === r.level ? styles.cardActive : ""}`}
                onClick={() => setSelected(r.level)}
              >
                <div className={styles.cardHead}>
                  <div>
                    <div className={styles.cardLevel}>Уровень {r.level}</div>
                    <div className={styles.cardName}>{r.name}</div>
                  </div>
                  <span className={styles.cardKind}>{r.kind}</span>
                </div>
                <div className={`${styles.cardMedia} ${
                  r.media === "bg" ? styles.mediaBg :
                  r.media === "nick" ? styles.mediaNick :
                  r.media === "trophy" ? styles.mediaTrophy : styles.mediaPatch
                }`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={r.img} alt="" loading="lazy" />
                </div>
                <p className={styles.cardText}>{r.text}</p>
              </button>
            ))}
          </div>

          <section className={styles.profilePreview} aria-label="Как фон и ник смотрятся в профиле">
            <div className={styles.profilePreviewHead}>Мини-превью профиля</div>
            <div className={styles.profileMock}>
              <div className={styles.profileMockInner}>
                <div className={styles.profileNickPreview}>{nick}</div>
                <p>Фон L5 · стиль ника L10 · центр фона свободен под контент</p>
              </div>
            </div>
          </section>

          <p className={styles.footNote}>
            Это только превью для Keech: страница не видна в меню, не индексируется
            и отдаёт 404 всем остальным. В боевой Battle Pass ничего не изменено.
          </p>
        </aside>
      </div>
    </main>
  );
}
