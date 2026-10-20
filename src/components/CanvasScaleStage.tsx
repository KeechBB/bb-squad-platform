"use client";

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

/** Эталон — композиция на 2K (2560×1440 минус шапка ~76px). */
export const CANVAS_REF_W = 2560;
export const CANVAS_REF_H = 1364;

type Props = {
  children: ReactNode;
  hasBg?: boolean;
  contentWidth?: number | "full";
  className?: string;
};

type Fit = {
  stageW: number;
  stageH: number;
  scale: number;
};

function supportsCssZoom() {
  try {
    return typeof CSS !== "undefined" && CSS.supports("zoom", "1");
  } catch {
    return false;
  }
}

/**
 * Сцена 2K на весь экран без чёрных полей.
 * Равномерный CSS zoom (чёткий текст) — холст подгоняется под aspect окна.
 */
export function CanvasScaleStage({
  children,
  hasBg = false,
  contentWidth = "full",
  className = "",
}: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [fit, setFit] = useState<Fit>({
    stageW: CANVAS_REF_W,
    stageH: CANVAS_REF_H,
    scale: 1,
  });
  const [useZoom, setUseZoom] = useState(true);

  useEffect(() => {
    setUseZoom(supportsCssZoom());
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || typeof ResizeObserver === "undefined") return;

    const measure = () => {
      const w = host.clientWidth;
      const h = host.clientHeight;
      if (w < 32 || h < 32) return;

      const hostAspect = w / h;
      const refAspect = CANVAS_REF_W / CANVAS_REF_H;
      let stageW = CANVAS_REF_W;
      let stageH = CANVAS_REF_H;
      // Расширяем холст под окно → равномерный scale заполняет 100% без letterbox.
      if (hostAspect > refAspect) {
        stageW = Math.round(CANVAS_REF_H * hostAspect);
      } else {
        stageH = Math.round(CANVAS_REF_W / hostAspect);
      }
      const scale = w / stageW;
      setFit({
        stageW,
        stageH,
        scale: Number.isFinite(scale) && scale > 0 ? scale : 1,
      });
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(host);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  const stageStyle = {
    width: fit.stageW,
    height: fit.stageH,
    ...(useZoom
      ? ({ zoom: fit.scale } as CSSProperties)
      : ({
          transform: `scale(${fit.scale})`,
          transformOrigin: "top left",
        } as CSSProperties)),
  } as CSSProperties;

  const slotStyle = useZoom
    ? undefined
    : ({
        width: fit.stageW * fit.scale,
        height: fit.stageH * fit.scale,
      } as CSSProperties);

  const innerStyle =
    contentWidth === "full"
      ? undefined
      : ({ width: contentWidth } as CSSProperties);

  const hostCls = [
    "canvas-scale-host",
    hasBg ? "has-stage-bg" : "",
    useZoom ? "is-zoom" : "is-transform",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div ref={hostRef} className={hostCls}>
      <div
        className={`canvas-scale-slot${hasBg ? " has-stage-bg" : ""}`}
        style={slotStyle}
      >
        <div className="canvas-scale-stage" style={stageStyle}>
          <div
            className={`canvas-scale-inner${
              contentWidth === "full" ? " is-full" : ""
            }`}
            style={innerStyle}
          >
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
