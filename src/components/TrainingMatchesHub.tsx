"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { TierFitPageClient } from "@/components/TierFitPageClient";
import type { HomeTierBoardData } from "@/lib/homeTierBoardUi";

type TabId = "matches" | "fit";
type FitSubId = "overview" | "detail";

type Props = {
  iframeSrc: string;
  /** Полный FIT (KV tfs-fit: доски по ролям, кандидаты, аналитика) */
  fitIframeSrc: string;
  board: HomeTierBoardData;
};

function parseTab(raw: string | null): TabId {
  if (raw === "fit" || raw === "tiers" || raw === "tiers-fit") return "fit";
  return "matches";
}

function parseFitSub(raw: string | null): FitSubId {
  if (raw === "detail" || raw === "разбор" || raw === "boards") return "detail";
  return "overview";
}

export function TrainingMatchesHub({
  iframeSrc,
  fitIframeSrc,
  board,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const fitFrameRef = useRef<HTMLIFrameElement>(null);
  const tab = useMemo(
    () => parseTab(searchParams.get("tab")),
    [searchParams]
  );
  const fitSub = useMemo(
    () => parseFitSub(searchParams.get("fit")),
    [searchParams]
  );

  const setTab = useCallback(
    (next: TabId) => {
      const q = new URLSearchParams(searchParams.toString());
      if (next === "matches") {
        q.delete("tab");
        q.delete("fit");
      } else {
        q.set("tab", "fit");
        if (!q.get("fit")) q.set("fit", "overview");
      }
      const s = q.toString();
      router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  const setFitSub = useCallback(
    (next: FitSubId) => {
      const q = new URLSearchParams(searchParams.toString());
      q.set("tab", "fit");
      if (next === "overview") q.delete("fit");
      else q.set("fit", "detail");
      const s = q.toString();
      router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  const syncFitFrameHeight = useCallback(() => {
    const frame = fitFrameRef.current;
    if (!frame) return;
    try {
      const doc = frame.contentDocument;
      if (!doc?.documentElement) return;
      const h = Math.max(
        doc.documentElement.scrollHeight || 0,
        doc.body?.scrollHeight || 0,
        520
      );
      frame.style.height = `${h}px`;
    } catch {
      /* ignore */
    }
  }, []);

  // Внешний hash #/tm/tiers → большая вкладка FIT (детальный разбор);
  // остальные #/tm* → матчи
  useEffect(() => {
    if (typeof window === "undefined") return;
    const h = window.location.hash || "";
    if (!h.startsWith("#/tm")) return;
    if (h.includes("/tiers")) {
      if (tab !== "fit" || fitSub !== "detail") {
        const q = new URLSearchParams(searchParams.toString());
        q.set("tab", "fit");
        q.set("fit", "detail");
        const s = q.toString();
        router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
      }
      return;
    }
    if (tab !== "matches") setTab("matches");
  }, [tab, fitSub, setTab, pathname, router, searchParams]);

  // Детальный FIT: растянуть iframe по контенту → один скролл страницы
  useEffect(() => {
    if (tab !== "fit" || fitSub !== "detail") return;
    const frame = fitFrameRef.current;
    if (!frame) return;

    let ro: ResizeObserver | null = null;
    let poll: number | undefined;
    let stopPoll: number | undefined;

    const attach = () => {
      syncFitFrameHeight();
      try {
        const doc = frame.contentDocument;
        if (!doc?.documentElement) return;
        ro?.disconnect();
        ro = new ResizeObserver(() => syncFitFrameHeight());
        ro.observe(doc.documentElement);
        if (doc.body) ro.observe(doc.body);
      } catch {
        /* ignore */
      }
    };

    const onLoad = () => {
      attach();
      window.clearInterval(poll);
      window.clearTimeout(stopPoll);
      poll = window.setInterval(syncFitFrameHeight, 400);
      stopPoll = window.setTimeout(() => window.clearInterval(poll), 10000);
    };

    frame.addEventListener("load", onLoad);
    if (frame.contentDocument?.readyState === "complete") onLoad();

    return () => {
      frame.removeEventListener("load", onLoad);
      ro?.disconnect();
      window.clearInterval(poll);
      window.clearTimeout(stopPoll);
    };
  }, [tab, fitSub, fitIframeSrc, syncFitFrameHeight]);

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
          <nav className="tier-fit-tabs" aria-label="Тиры FIT">
            <button
              type="button"
              className={`tier-fit-tab${fitSub === "overview" ? " is-active" : ""}`}
              aria-pressed={fitSub === "overview"}
              onClick={() => setFitSub("overview")}
            >
              Обзор
            </button>
            <button
              type="button"
              className={`tier-fit-tab${fitSub === "detail" ? " is-active" : ""}`}
              aria-pressed={fitSub === "detail"}
              onClick={() => setFitSub("detail")}
            >
              Детальный разбор
            </button>
          </nav>

          {fitSub === "overview" ? (
            <TierFitPageClient board={board} embedded />
          ) : (
            <section
              className="tm-hub-fit-detail is-tab"
              aria-label="Детальный Fit по ролям"
            >
              <header className="tm-hub-fit-detail-head">
                <h2>Детальный разбор</h2>
                <p className="muted">
                  Доски по тирам и ролям · Fit% · рычаги роста · кандидаты ·
                  аналитика (только КВ; роль = кит с тренировок)
                </p>
              </header>
              <div className="cw-embed tm-hub-fit-frame">
                <iframe
                  ref={fitFrameRef}
                  className="cw-frame"
                  src={fitIframeSrc}
                  title="Тиры Fit — детальный разбор"
                  allow="fullscreen"
                  scrolling="no"
                />
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
