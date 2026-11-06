"use client";

import { useMemo, useState } from "react";
import type { TrainMatchHistoryRow } from "@/lib/homeTrainPwr";
import { TrainingMatchHistory } from "@/components/TrainingSessionsCard";
import { PublicMatchHistory } from "@/components/PublicMatchHistory";

export type MatchHistoryTab = "train" | "public";

type Props = {
  trainHistory?: TrainMatchHistoryRow[];
  publicHistory?: TrainMatchHistoryRow[];
  trainTotal?: number;
  publicTotal?: number;
  highlightNick?: string;
  /** BlackBerry → train; иначе public */
  defaultTab?: MatchHistoryTab;
};

export function ProfileMatchHistoryTabs({
  trainHistory = [],
  publicHistory = [],
  trainTotal,
  publicTotal,
  highlightNick,
  defaultTab = "train",
}: Props) {
  const initial = useMemo<MatchHistoryTab>(
    () => (defaultTab === "public" ? "public" : "train"),
    [defaultTab]
  );
  const [tab, setTab] = useState<MatchHistoryTab>(initial);
  const trainCount = trainTotal ?? trainHistory.length;
  const publicCount = publicTotal ?? publicHistory.length;

  return (
    <div className="profile-match-hist-tabs">
      <div
        className="profile-match-hist-tablist"
        role="tablist"
        aria-label="История матчей"
      >
        <button
          type="button"
          role="tab"
          aria-selected={tab === "train"}
          className={`profile-match-hist-tab${tab === "train" ? " is-active" : ""}`}
          onClick={() => setTab("train")}
        >
          История матчей тренировок
          {trainCount > 0 ? (
            <span className="profile-match-hist-count">{trainCount}</span>
          ) : null}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "public"}
          className={`profile-match-hist-tab${tab === "public" ? " is-active" : ""}`}
          onClick={() => setTab("public")}
        >
          История матчей паблика
          {publicCount > 0 ? (
            <span className="profile-match-hist-count">{publicCount}</span>
          ) : null}
        </button>
      </div>

      <div role="tabpanel" hidden={tab !== "train"}>
        <TrainingMatchHistory
          matchHistory={trainHistory}
          historyTotal={trainTotal}
          highlightNick={highlightNick}
          hideTitle
        />
      </div>
      <div role="tabpanel" hidden={tab !== "public"}>
        <PublicMatchHistory
          matchHistory={publicHistory}
          historyTotal={publicTotal}
          highlightNick={highlightNick}
          hideTitle
        />
      </div>
    </div>
  );
}
