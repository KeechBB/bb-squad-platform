"use client";

import { useMemo, useState } from "react";
import type { TrainMatchHistoryRow } from "@/lib/homeTrainPwr";
import { TrainingMatchHistory } from "@/components/TrainingSessionsCard";
import { PublicMatchHistory } from "@/components/PublicMatchHistory";

export type MatchHistoryTab = "train" | "public";

type Props = {
  trainHistory?: TrainMatchHistoryRow[];
  publicHistory?: TrainMatchHistoryRow[];
  highlightNick?: string;
  /** BlackBerry → train; иначе public */
  defaultTab?: MatchHistoryTab;
};

export function ProfileMatchHistoryTabs({
  trainHistory = [],
  publicHistory = [],
  highlightNick,
  defaultTab = "train",
}: Props) {
  const initial = useMemo<MatchHistoryTab>(
    () => (defaultTab === "public" ? "public" : "train"),
    [defaultTab]
  );
  const [tab, setTab] = useState<MatchHistoryTab>(initial);

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
          {trainHistory.length > 0 ? (
            <span className="profile-match-hist-count">{trainHistory.length}</span>
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
          {publicHistory.length > 0 ? (
            <span className="profile-match-hist-count">{publicHistory.length}</span>
          ) : null}
        </button>
      </div>

      <div role="tabpanel" hidden={tab !== "train"}>
        <TrainingMatchHistory
          matchHistory={trainHistory}
          highlightNick={highlightNick}
          hideTitle
        />
      </div>
      <div role="tabpanel" hidden={tab !== "public"}>
        <PublicMatchHistory
          matchHistory={publicHistory}
          highlightNick={highlightNick}
          hideTitle
        />
      </div>
    </div>
  );
}
