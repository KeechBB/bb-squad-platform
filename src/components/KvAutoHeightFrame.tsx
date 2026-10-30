"use client";

import { useCallback, useEffect, useState, useRef } from "react";
import { createPortal } from "react-dom";

type Props = {
  src: string;
  title: string;
  className?: string;
  minHeight?: number;
};

/**
 * KV iframe без собственного скролла: высота = контент → один скролл страницы
 * (как рейтинг паблика).
 */
export function KvAutoHeightFrame({
  src,
  title,
  className,
  minHeight = 420,
}: Props) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [devOpen, setDevOpen] = useState(false);

  const applyHeight = useCallback(
    (raw: number) => {
      const frame = frameRef.current;
      if (!frame) return;
      const h = Math.max(Math.ceil(raw), minHeight);
      frame.style.height = `${h}px`;
    },
    [minHeight]
  );

  const syncFromDoc = useCallback(() => {
    const frame = frameRef.current;
    if (!frame) return;
    try {
      const doc = frame.contentDocument;
      if (!doc?.documentElement) return;
      const y = doc.defaultView?.scrollY || 0;
      let bottom = 0;
      for (const id of ["view-tm", "view-cw", "view-home"]) {
        const el = doc.getElementById(id);
        if (!el || el.hidden) continue;
        if (doc.defaultView?.getComputedStyle(el).display === "none") continue;
        bottom = Math.max(bottom, el.getBoundingClientRect().bottom + y);
      }
      // Только низ активной вкладки — не scrollHeight документа
      // (иначе iframe min-height раздувает пустоту по кругу).
      const h = Math.max(bottom + 24, minHeight);
      applyHeight(h);
    } catch {
      /* ignore */
    }
  }, [applyHeight, minHeight]);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;

    let ro: ResizeObserver | null = null;
    let poll: number | undefined;
    let slowPoll: number | undefined;

    const attach = () => {
      syncFromDoc();
      try {
        const doc = frame.contentDocument;
        if (!doc?.documentElement) return;
        if (!doc.getElementById("bb-embed-clear-bg")) {
          const style = doc.createElement("style");
          style.id = "bb-embed-clear-bg";
          style.textContent =
            "html,body{background:transparent!important;background-image:none!important;color-scheme:normal!important}.atmosphere{display:none!important}";
          doc.head?.appendChild(style);
        }
        ro?.disconnect();
        ro = new ResizeObserver(() => syncFromDoc());
        ro.observe(doc.documentElement);
        if (doc.body) ro.observe(doc.body);
        const tm = doc.getElementById("view-tm");
        if (tm) ro.observe(tm);
        const cw = doc.getElementById("view-cw");
        if (cw) ro.observe(cw);
      } catch {
        /* ignore */
      }
    };

    const onLoad = () => {
      attach();
      window.clearInterval(poll);
      window.clearInterval(slowPoll);
      // Быстрый опрос пока таблица подгружается, потом редкий — на случай дорисовки.
      poll = window.setInterval(syncFromDoc, 400);
      window.setTimeout(() => {
        window.clearInterval(poll);
        slowPoll = window.setInterval(syncFromDoc, 2000);
      }, 20000);
    };

    const onMsg = (e: MessageEvent) => {
      const data = e.data;
      if (!data || typeof data !== "object") return;
      if (e.origin !== window.location.origin) return;
      if (data.type === "bb-tm-dev-open") {
        setDevOpen(true);
        return;
      }
      if (data.type === "bb-kv-hash" && typeof data.hash === "string") {
        const path = window.location.pathname;
        if (path !== "/tm" && path !== "/cw") return;
        const hash = data.hash;
        let tab = "";
        if (path === "/tm") {
          if (hash.startsWith("#/tm/growth")) tab = "growth";
          else if (hash.includes("rating")) tab = "rating";
          else if (hash.includes("/hits")) tab = "hits";
        } else if (hash.includes("analytics")) tab = "analytics";
        else if (hash.includes("rating")) tab = "rating";
        const url = new URL(window.location.href);
        if (tab) url.searchParams.set("tab", tab);
        else url.searchParams.delete("tab");
        url.hash = "";
        const next = url.pathname + url.search;
        const cur = window.location.pathname + window.location.search;
        if (next !== cur) history.replaceState(null, "", next);
        return;
      }
      if (data.type !== "bb-kv-embed-height") return;
      if (typeof data.height !== "number" || !Number.isFinite(data.height)) {
        return;
      }
      applyHeight(data.height);
    };

    frame.addEventListener("load", onLoad);
    window.addEventListener("message", onMsg);
    if (frame.contentDocument?.readyState === "complete") onLoad();

    return () => {
      frame.removeEventListener("load", onLoad);
      window.removeEventListener("message", onMsg);
      ro?.disconnect();
      window.clearInterval(poll);
      window.clearInterval(slowPoll);
    };
  }, [src, syncFromDoc, applyHeight]);

  return (
    <div className={`cw-embed cw-autoheight${className ? ` ${className}` : ""}`}>
      <iframe
        ref={frameRef}
        className="cw-frame"
        src={src}
        title={title}
        allow="fullscreen"
        scrolling="no"
        style={{ minHeight }}
      />
      {devOpen
        ? createPortal(
            <div className="tm-dev-plaque" role="dialog" aria-modal="true">
              <div className="tm-dev-plaque-card">
                <p>На данный момент раздел находится в разработке</p>
                <button type="button" onClick={() => setDevOpen(false)}>
                  Понял
                </button>
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
