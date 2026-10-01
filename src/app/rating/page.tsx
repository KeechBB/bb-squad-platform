import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import {
  buildClanEloBoard,
  buildEnemyPwrBoard,
  listMeetings,
} from "@/lib/crossRating";
import { CrossRatingClient } from "@/components/CrossRatingClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function RatingPage() {
  const session = await getSession();
  if (!session?.user?.steamId) redirect("/");
  if (!session.user.profileComplete) redirect("/register");

  const [clans, enemies, meetings] = await Promise.all([
    buildClanEloBoard(),
    buildEnemyPwrBoard(),
    listMeetings(),
  ]);

  return (
    <main className="profile-page">
      <section className="card profile-head-public">
        <p className="eyebrow">межклановый рейтинг</p>
        <h1>Рейтинг</h1>
        <p className="muted" style={{ margin: "6px 0 0", lineHeight: 1.45 }}>
          Команды (Elo) и игроки соперников (PWR). Встречи из КВ ·{" "}
          {clans.meetings} сыграно · BB Elo {clans.bbElo}
        </p>
      </section>
      <CrossRatingClient
        clans={clans}
        enemies={enemies}
        meetings={meetings}
      />
    </main>
  );
}
