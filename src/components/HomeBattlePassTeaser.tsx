import Link from "next/link";
import { BP_S2_SCHEDULE } from "@/lib/battlePassSchedule";

/** Скрытый тизер Season 2 на главной (вместо турнирного анонса в паузе). */
export function HomeBattlePassTeaser() {
  return (
    <Link
      href="/battle-pass"
      className="home-bp-teaser"
      aria-label={`Battle Pass Season 2 — старт ${BP_S2_SCHEDULE.startLabel}`}
    >
      <div className="home-bp-teaser-art" aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          className="home-bp-teaser-img"
          src="/bp-halloween/gallows-animated.webp"
          alt=""
          width={220}
          height={220}
        />
        <span className="home-bp-teaser-fog" />
      </div>
      <div className="home-bp-teaser-body">
        <p className="home-bp-teaser-eyebrow">Battle Pass · Season 2</p>
        <h2 className="home-bp-teaser-title">В саду зреет что-то новое…</h2>
        <p className="home-bp-teaser-meta">
          Тыквы ещё молчат. Награды ещё в тумане.
          <br />
          Открытие — <strong>{BP_S2_SCHEDULE.startLabel}</strong>
        </p>
        <p className="home-bp-teaser-cta">Ждите · 04.11 →</p>
      </div>
    </Link>
  );
}
