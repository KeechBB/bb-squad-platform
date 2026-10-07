import { ProfileKvMatchHistory } from "@/components/ProfileKvStats";
import { ProfileStatsTabs } from "@/components/ProfileStatsTabs";
import { ProfileMatchHistoryTabs } from "@/components/ProfileMatchHistoryTabs";
import { loadPlayerProfileHeavy } from "@/lib/playerProfileHeavy";

type Props = {
  nick: string;
  /** Куда класть вкладки статы: внутри account или отдельно */
  mode?: "full" | "stats-only" | "histories-only";
  defaultHistTab?: "train" | "public";
};

export async function ProfileHeavySection({
  nick,
  mode = "full",
  defaultHistTab = "train",
}: Props) {
  const heavy = await loadPlayerProfileHeavy(nick);

  const stats = (
    <ProfileStatsTabs
      kvStats={heavy.kvStats}
      kvError={heavy.kvError}
      trainStats={heavy.trainCombat}
      publicStats={heavy.publicCombat}
    />
  );

  const histories = (
    <>
      <div className="profile-area-kv-hist">
        <ProfileKvMatchHistory
          matchHistory={heavy.cwHistory}
          highlightNick={nick}
        />
      </div>
      <div className="profile-area-train-hist">
        <ProfileMatchHistoryTabs
          trainHistory={heavy.trainHistory}
          publicHistory={heavy.publicHistory}
          highlightNick={nick}
          defaultTab={defaultHistTab}
        />
      </div>
    </>
  );

  if (mode === "stats-only") return stats;
  if (mode === "histories-only") return histories;
  return (
    <>
      {stats}
      {histories}
    </>
  );
}

export function ProfileHeavyFallback({ label }: { label?: string }) {
  return (
    <div className="card" style={{ padding: 16 }}>
      <p className="muted" style={{ margin: 0 }}>
        {label || "Загрузка статистики…"}
      </p>
    </div>
  );
}
