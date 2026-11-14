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
  if (!progress.live) return null;

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

      {!loggedIn ? (
        <p className="home-event-day-stub">
          Зарегистрируйтесь на сайте для участия в ивенте.{" "}
          <Link href="/register">Регистрация →</Link>
        </p>
      ) : (
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
              <h3>АК-74 «Яблочный разброс»</h3>
              <p>
                <strong>{EVENT_DAY_KILLS_GOAL} киллов</strong> · 15:45–23:59
              </p>
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
              <h3>АК-74 «Лимонный шквал»</h3>
              <p>
                <strong>{EVENT_DAY_RES_GOAL} ресов</strong> (из нока) ·
                15:45–23:59
              </p>
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
            </div>
          </article>
        </div>
      )}

      {loggedIn ? (
        <p className="home-event-day-foot">
          Награда остаётся в кастомизации навсегда.{" "}
          <Link href="/profile">Открыть профиль →</Link>
        </p>
      ) : null}
    </section>
  );
}
