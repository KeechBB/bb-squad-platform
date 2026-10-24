import { CanvasScaleStage } from "@/components/CanvasScaleStage";
import { BP_INTERMISSION } from "@/lib/battlePassSchedule";

/** Заглушка между сезонами (3 дня после PB1, до старта Season 2). */
export function BattlePassIntermission() {
  return (
    <CanvasScaleStage contentWidth="full" className="is-bp">
      <main className="bp-page bp-intermission">
        <section className="bp-intermission-card" aria-live="polite">
          <p className="bp-intermission-eyebrow">{BP_INTERMISSION.eyebrow}</p>
          <h1 className="bp-intermission-title">{BP_INTERMISSION.title}</h1>
          <p className="bp-intermission-headline">{BP_INTERMISSION.headline}</p>
          <p className="bp-intermission-body">
            {BP_INTERMISSION.body.split("\n").map((line, i) => (
              <span key={i}>
                {i > 0 ? <br /> : null}
                {line}
              </span>
            ))}
          </p>
          <p className="bp-intermission-wait">{BP_INTERMISSION.waitLabel}</p>
          <p className="bp-intermission-dates">{BP_INTERMISSION.windowLabel}</p>
        </section>
      </main>
    </CanvasScaleStage>
  );
}
