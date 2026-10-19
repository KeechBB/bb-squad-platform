"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ProfileTrainPwrCard } from "@/components/ProfileTrainPwrCard";
import { ProfilePublicRatingCard } from "@/components/ProfilePublicRatingCard";
import { TrainingSessionsCard } from "@/components/TrainingSessionsCard";
import { ProfileStatsTabs } from "@/components/ProfileStatsTabs";
import { ProfileKvMatchHistory } from "@/components/ProfileKvStats";
import { ProfileMatchHistoryTabs } from "@/components/ProfileMatchHistoryTabs";
import { TrainingMatchHistory } from "@/components/TrainingSessionsCard";
import { PublicMatchHistory } from "@/components/PublicMatchHistory";
import type { ProfileMode } from "@/components/ProfileModeSwitch";
import type { HomeTrainPwrRow } from "@/lib/homeTrainPwr";
import type {
  PlayerProfileHistories,
  PlayerProfileStats,
} from "@/lib/playerProfileHeavy";
import {
  loadProfileView,
  peekProfileView,
  type ProfileViewBundle,
} from "@/lib/profileViewCache";

function Fallback({ label }: { label: string }) {
  return (
    <div className="card" style={{ padding: 16 }}>
      <p className="muted" style={{ margin: 0 }}>
        {label}
      </p>
    </div>
  );
}

type PublicSummary = {
  combat: Parameters<typeof ProfilePublicRatingCard>[0]["combat"];
  rp: {
    rp?: number | null;
    rankLabel?: string | null;
    rankKey?: string | null;
    matches?: unknown;
  } | null;
} | null;

type TrainingBundle = {
  tr1: {
    sessions: unknown[];
    presentDays: string[];
    lateDays: string[];
    reserveDays: string[];
    dayOffDays: string[];
    visitBounds: Record<string, { joinHm: string; leaveHm: string | null }>;
    minutes30d: number;
    sessions30d: number;
    openNow: boolean;
  };
  tr2: {
    sessions: unknown[];
    presentDays: string[];
    lateDays: string[];
    reserveDays: string[];
    dayOffDays: string[];
    visitBounds: Record<string, { joinHm: string; leaveHm: string | null }>;
    minutes30d: number;
    sessions30d: number;
    openNow: boolean;
  };
};

type PublicAtt = {
  sessions: unknown[];
  presentDays: string[];
  lateDays: string[];
  visitBounds: Record<string, { joinHm: string; leaveHm: string | null }>;
  minutes30d: number;
  sessions30d: number;
  openNow: boolean;
} | null;

type Props = {
  nick: string;
  defaultHistTab?: "train" | "public";
  slot: "head" | "stats" | "training" | "histories" | "history";
  /** Режим профиля v2 — фильтрует стату/историю */
  mode?: ProfileMode;
  /** Выходной / резерв — в календаре */
  absenceSlot?: ReactNode;
};

type CwAtt = {
  byDay: Record<
    string,
    { present: boolean; opp: string; logoUrl: string | null; map?: string }
  >;
} | null;

function applyBundle(
  data: ProfileViewBundle | null,
  setters: {
    setTrainPwr: (v: HomeTrainPwrRow | null) => void;
    setPublicSummary: (v: PublicSummary) => void;
    setTraining: (v: TrainingBundle | null) => void;
    setPublicAtt: (v: PublicAtt) => void;
    setCwAtt: (v: CwAtt) => void;
    setStats: (v: PlayerProfileStats | null) => void;
    setHistories: (v: PlayerProfileHistories | null) => void;
  }
) {
  if (!data) return;
  if (data.trainPwr !== undefined) {
    setters.setTrainPwr((data.trainPwr as HomeTrainPwrRow) ?? null);
  }
  if (data.publicSummary !== undefined) {
    setters.setPublicSummary((data.publicSummary as PublicSummary) ?? null);
  }
  if (data.training !== undefined) {
    setters.setTraining((data.training as TrainingBundle) ?? null);
  }
  if (data.publicAtt !== undefined) {
    setters.setPublicAtt((data.publicAtt as PublicAtt) ?? null);
  }
  if (data.cwAtt !== undefined) {
    setters.setCwAtt((data.cwAtt as CwAtt) ?? null);
  }
  if (data.stats !== undefined) {
    setters.setStats((data.stats as PlayerProfileStats) ?? null);
  }
  if (data.histories !== undefined) {
    setters.setHistories((data.histories as PlayerProfileHistories) ?? null);
  }
}

export function ProfileClientHydrate({
  nick,
  defaultHistTab = "train",
  slot,
  mode,
  absenceSlot,
}: Props) {
  const cached = typeof window !== "undefined" ? peekProfileView(nick) : null;

  const [trainPwr, setTrainPwr] = useState<HomeTrainPwrRow | null>(
    () => (cached?.trainPwr as HomeTrainPwrRow) ?? null
  );
  const [publicSummary, setPublicSummary] = useState<PublicSummary>(
    () => (cached?.publicSummary as PublicSummary) ?? null
  );
  const [training, setTraining] = useState<TrainingBundle | null>(
    () => (cached?.training as TrainingBundle) ?? null
  );
  const [publicAtt, setPublicAtt] = useState<PublicAtt>(
    () => (cached?.publicAtt as PublicAtt) ?? null
  );
  const [cwAtt, setCwAtt] = useState<CwAtt>(
    () => (cached?.cwAtt as CwAtt) ?? null
  );
  const [stats, setStats] = useState<PlayerProfileStats | null>(
    () => (cached?.stats as PlayerProfileStats) ?? null
  );
  const [histories, setHistories] = useState<PlayerProfileHistories | null>(
    () => (cached?.histories as PlayerProfileHistories) ?? null
  );
  const [loading, setLoading] = useState(!cached);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!nick && slot !== "training") {
      setLoading(false);
      return;
    }
    let cancelled = false;
    const peek = peekProfileView(nick);
    if (peek) {
      applyBundle(peek, {
        setTrainPwr,
        setPublicSummary,
        setTraining,
        setPublicAtt,
        setCwAtt,
        setStats,
        setHistories,
      });
      setLoading(false);
    } else {
      setLoading(true);
    }

    void loadProfileView(nick).then((data) => {
      if (cancelled) return;
      if (!data) {
        setFailed(true);
        setLoading(false);
        return;
      }
      applyBundle(data, {
        setTrainPwr,
        setPublicSummary,
        setTraining,
        setPublicAtt,
        setCwAtt,
        setStats,
        setHistories,
      });
      setFailed(false);
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [nick, slot]);

  if (slot === "head") {
    return (
      <>
        {loading && !trainPwr ? (
          <Fallback label="Загрузка Train PWR…" />
        ) : (
          <ProfileTrainPwrCard stats={trainPwr} compareNick={nick} />
        )}
        {loading && !publicSummary ? (
          <Fallback label="Загрузка паблик-рейтинга…" />
        ) : failed && !publicSummary ? (
          <Fallback label="Паблик-рейтинг временно недоступен" />
        ) : (
          <ProfilePublicRatingCard
            nick={nick}
            rp={publicSummary?.rp?.rp ?? null}
            rankLabel={publicSummary?.rp?.rankLabel ?? null}
            rankKey={publicSummary?.rp?.rankKey ?? null}
            combat={publicSummary?.combat ?? null}
            matches={publicSummary?.rp?.matches ?? []}
          />
        )}
      </>
    );
  }

  if (slot === "stats") {
    if (loading && !stats) {
      return <Fallback label="Загрузка вкладок статы…" />;
    }
    if (!stats) {
      return (
        <Fallback
          label={
            failed
              ? "Стата временно недоступна"
              : "Загрузка вкладок статы…"
          }
        />
      );
    }
    const forced =
      mode === "cw" ? "cw" : mode === "train" ? "train" : mode === "public" ? "public" : undefined;
    return (
      <ProfileStatsTabs
        kvStats={stats.kvStats}
        kvError={stats.kvError}
        trainStats={stats.trainCombat}
        publicStats={stats.publicCombat}
        forcedTab={forced}
        hideTablist={Boolean(forced)}
      />
    );
  }

  if (slot === "training") {
    if (loading && !training) {
      return <Fallback label="Загрузка календаря тренировок…" />;
    }
    if (!training) {
      return (
        <Fallback
          label={
            failed
              ? "Календарь временно недоступен"
              : "Загрузка календаря тренировок…"
          }
        />
      );
    }
    const pub = publicAtt || {
      sessions: [],
      presentDays: [] as string[],
      lateDays: [] as string[],
      visitBounds: {} as Record<
        string,
        { joinHm: string; leaveHm: string | null }
      >,
      minutes30d: 0,
      sessions30d: 0,
      openNow: false,
    };
    const preferredServer =
      mode === "public" ? "PB1" : mode === "train" ? "TR1" : undefined;
    return (
      <TrainingSessionsCard
        sessions={training.tr1.sessions as never}
        presentDays={training.tr1.presentDays}
        lateDays={training.tr1.lateDays}
        reserveDays={training.tr1.reserveDays}
        dayOffDays={training.tr1.dayOffDays}
        visitBounds={training.tr1.visitBounds}
        minutes30d={training.tr1.minutes30d}
        sessions30d={training.tr1.sessions30d}
        openNow={training.tr1.openNow}
        includeMatchHistory={false}
        absenceSlot={absenceSlot}
        preferredServer={preferredServer}
        hideServerToggle
        hideStatRow
        cwMode={mode === "cw"}
        cwByDay={cwAtt?.byDay || {}}
        tr2Lane={{
          sessions: training.tr2.sessions as never,
          presentDays: training.tr2.presentDays,
          lateDays: training.tr2.lateDays,
          reserveDays: training.tr2.reserveDays,
          dayOffDays: training.tr2.dayOffDays,
          visitBounds: training.tr2.visitBounds,
          minutes30d: training.tr2.minutes30d,
          sessions30d: training.tr2.sessions30d,
          openNow: training.tr2.openNow,
        }}
        publicLane={{
          sessions: pub.sessions as never,
          presentDays: pub.presentDays,
          lateDays: pub.lateDays,
          visitBounds: pub.visitBounds,
          minutes30d: pub.minutes30d,
          sessions30d: pub.sessions30d,
          openNow: pub.openNow,
        }}
      />
    );
  }

  if (loading && !histories) {
    return <Fallback label="Загрузка историй матчей…" />;
  }
  if (!histories) {
    return (
      <Fallback
        label={
          failed
            ? "Истории временно недоступны"
            : "Загрузка историй матчей…"
        }
      />
    );
  }

  if (slot === "history" && mode) {
    if (mode === "cw") {
      return (
        <ProfileKvMatchHistory
          matchHistory={histories.cwHistory}
          highlightNick={nick}
        />
      );
    }
    if (mode === "train") {
      return (
        <TrainingMatchHistory
          matchHistory={histories.trainHistory}
          highlightNick={nick}
        />
      );
    }
    return (
      <PublicMatchHistory
        matchHistory={histories.publicHistory}
        highlightNick={nick}
      />
    );
  }

  return (
    <>
      <div className="profile-area-kv-hist">
        <ProfileKvMatchHistory
          matchHistory={histories.cwHistory}
          highlightNick={nick}
        />
      </div>
      <div className="profile-area-train-hist">
        <ProfileMatchHistoryTabs
          trainHistory={histories.trainHistory}
          publicHistory={histories.publicHistory}
          highlightNick={nick}
          defaultTab={defaultHistTab}
        />
      </div>
    </>
  );
}
