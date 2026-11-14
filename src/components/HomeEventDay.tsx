import Link from "next/link";
import {
  EVENT_DAY_KILLS_GOAL,
  EVENT_DAY_RES_GOAL,
  EVENT_DAY_SAIGA_PATCH_ID,
  EVENT_DAY_SCAR_PATCH_ID,
  type EventDayProgress,
} from "@/lib/eventDay";
import { profilePatchUrl } from "@/lib/profilePatches";

type Props = {
  progress: EventDayProgress;
  loggedIn: boolean;
};

function pct(now: number, goal: number) {
  if (goal <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((now / goal) * 100)));
}

export function HomeEventDay({ progress, loggedIn }: Props) {
  const saigaSrc = profilePatchUrl(EVENT_DAY_SAIGA_PATCH_ID);
  const scarSrc = profilePatchUrl(EVENT_DAY_SCAR_PATCH_ID);

  return (
    <section className="home-event-day" aria-label="Ивент дня">
      <div className="home-event-day-head">
        <p className="home-event-day-eyebrow">Ивент дня · Фруктовый сад</p>
        <h2 className="home-event-day-title">Ежедневные нашивки</h2>
        <p className="home-event-day-until">
          Действует <strong>{progress.untilLabel}</strong>
        </p>
      </div>

      <div className="home-event-day-grid">
        <article className="home-event-day-card" data-reward="saiga">
          <div className="home-event-day-art" aria-hidden="true">
            {saigaSrc ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                className="home-event-day-gun home-event-day-gun--flip"
                src={saigaSrc}
                alt=""
                width={320}
                height={90}
              />
            ) : null}
          </div>
          <div className="home-event-day-copy">
            <h3>Сайга «Яблочный разброс»</h3>
            <p>
              <strong>{EVENT_DAY_KILLS_GOAL} киллов</strong> за сутки на паблике
            </p>
            {loggedIn ? (
              <div className="home-event-day-bar" aria-label="Прогресс киллов">
                <span
                  style={{
                    width: `${pct(progress.kills, EVENT_DAY_KILLS_GOAL)}%`,
                  }}
                />
                <em>
                  {Math.min(progress.kills, EVENT_DAY_KILLS_GOAL)} /{" "}
                  {EVENT_DAY_KILLS_GOAL}
                  {progress.saigaUnlocked || progress.saigaDone
                    ? " · получено"
                    : ""}
                </em>
              </div>
            ) : null}
          </div>
        </article>

        <article className="home-event-day-card" data-reward="scar">
          <div className="home-event-day-art" aria-hidden="true">
            {scarSrc ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                className="home-event-day-gun home-event-day-gun--flip"
                src={scarSrc}
                alt=""
                width={320}
                height={90}
              />
            ) : null}
          </div>
          <div className="home-event-day-copy">
            <h3>SCAR «Лимонный шквал»</h3>
            <p>
              <strong>{EVENT_DAY_RES_GOAL} ресов</strong> за сутки на паблике
            </p>
            {loggedIn ? (
              <div className="home-event-day-bar" aria-label="Прогресс ресов">
                <span
                  style={{
                    width: `${pct(progress.res, EVENT_DAY_RES_GOAL)}%`,
                  }}
                />
                <em>
                  {Math.min(progress.res, EVENT_DAY_RES_GOAL)} /{" "}
                  {EVENT_DAY_RES_GOAL}
                  {progress.scarUnlocked || progress.scarDone
                    ? " · получено"
                    : ""}
                </em>
              </div>
            ) : null}
          </div>
        </article>
      </div>

      <p className="home-event-day-foot">
        {loggedIn ? (
          <>
            Награда остаётся в кастомизации навсегда.{" "}
            <Link href="/profile">Открыть профиль →</Link>
          </>
        ) : (
          <>Войдите на сайт, чтобы видеть свой прогресс за сегодня.</>
        )}
      </p>
    </section>
  );
}
