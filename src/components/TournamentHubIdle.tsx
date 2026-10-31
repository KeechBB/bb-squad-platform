import { HUB_IDLE_COPY } from "@/lib/tournamentHubShared";

export function TournamentHubIdle({
  kind = "tournaments",
}: {
  kind?: "tournaments" | "bets";
}) {
  return (
    <section className="tn-panel tn-idle" aria-label="Нет активного турнира">
      <p className="tn-idle-eyebrow">Турнирный хаб</p>
      <h2 className="tn-panel-title">{HUB_IDLE_COPY.title}</h2>
      <p className="tn-idle-body">{HUB_IDLE_COPY.body}</p>
      {kind === "bets" ? (
        <p className="tn-idle-body">{HUB_IDLE_COPY.betsExtra}</p>
      ) : null}
      <p className="tn-idle-hint">{HUB_IDLE_COPY.hint}</p>
    </section>
  );
}
