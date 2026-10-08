"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { TierFitPageClient } from "@/components/TierFitPageClient";
import type { HomeTierBoardData } from "@/lib/homeTierBoardUi";

type TabId = "matches" | "fit";

type Props = {
  iframeSrc: string;
  board: HomeTierBoardData;
};

function parseTab(raw: string | null): TabId {
  if (raw === "fit" || raw === "tiers" || raw === "tiers-fit") return "fit";
  return "matches";
}

export function TrainingMatchesHub({ iframeSrc, board }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tab = useMemo(
    () => parseTab(searchParams.get("tab")),
    [searchParams]
  );

  const setTab = useCallback(
    (next: TabId) => {
      const q = new URLSearchParams(searchParams.toString());
      if (next === "matches") q.delete("tab");
      else q.set("tab", "fit");
      const s = q.toString();
      router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  // Hash links like /tm#/tm/rating stay on matches tab
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.location.hash.startsWith("#/tm") && tab !== "matches") {
      setTab("matches");
    }
  }, [tab, setTab]);

  return (
    <div className={`tm-hub${tab === "matches" ? " is-matches" : " is-fit"}`}>
      <nav className="tm-hub-tabs" aria-label="Тренировочные матчи">
        <button
          type="button"
          className={`tm-hub-tab${tab === "matches" ? " is-active" : ""}`}
          aria-pressed={tab === "matches"}
          onClick={() => setTab("matches")}
        >
          Матчи
        </button>
        <button
          type="button"
          className={`tm-hub-tab tm-hub-tab-fit${tab === "fit" ? " is-active" : ""}`}
          aria-pressed={tab === "fit"}
          onClick={() => setTab("fit")}
        >
          Тиры FIT
        </button>
      </nav>

      {tab === "matches" ? (
        <div className="cw-embed tm-hub-embed">
          <iframe
            className="cw-frame"
            src={iframeSrc}
            title="Тренировочные матчи BlackBerry"
            allow="fullscreen"
          />
        </div>
      ) : (
        <div className="tm-hub-fit">
          <TierFitPageClient board={board} embedded />
        </div>
      )}
    </div>
  );
}
