"use client";

import { useCallback, useEffect, useRef } from "react";

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
  minHeight = 480,
}: Props) {
  const frameRef = useRef<HTMLIFrameElement>(null);

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
      const h = Math.max(
        doc.documentElement.scrollHeight || 0,
        doc.body?.scrollHeight || 0,
        minHeight
      );
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
    let stopPoll: number | undefined;

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
      } catch {
        /* ignore */
      }
    };

    const onLoad = () => {
      attach();
      window.clearInterval(poll);
      window.clearTimeout(stopPoll);
      poll = window.setInterval(syncFromDoc, 500);
      stopPoll = window.setTimeout(() => window.clearInterval(poll), 15000);
    };

    const onMsg = (e: MessageEvent) => {
      const data = e.data;
      if (!data || data.type !== "bb-kv-embed-height") return;
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
      window.clearTimeout(stopPoll);
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
      />
    </div>
  );
}
