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

/** Доля ширины окна слева/справа под фон (≈ красная рамка). */
const SIDE_INSET_FRAC = 0.1;
const SIDE_INSET_MIN_PX = 96;

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
  boxW: number;
  boxH: number;
  insetPx: number;
};

function supportsCssZoom() {
  try {
    return typeof CSS !== "undefined" && CSS.supports("zoom", "1");
  } catch {
    return false;
  }
}

/**
 * Сцена 2K. Для профиля с is-side-inset — поля по бокам под фон.
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
    boxW: CANVAS_REF_W,
    boxH: CANVAS_REF_H,
    insetPx: 0,
  });
  const [useZoom, setUseZoom] = useState(true);

  useEffect(() => {
    setUseZoom(supportsCssZoom());
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || typeof ResizeObserver === "undefined") return;

    const measure = () => {
      const sideInset = host.classList.contains("is-side-inset");
      const hostW = host.clientWidth;
      const hostH = host.clientHeight;
      const insetPx = sideInset
        ? Math.max(SIDE_INSET_MIN_PX, Math.round(hostW * SIDE_INSET_FRAC))
        : 0;
      // Поля задаём инлайном — CSS zoom/slot больше их не съедает.
      host.style.paddingLeft = insetPx ? `${insetPx}px` : "";
      host.style.paddingRight = insetPx ? `${insetPx}px` : "";
      host.style.paddingTop = "";
      host.style.paddingBottom = "";
      host.style.boxSizing = "border-box";

      const w = Math.max(32, hostW - insetPx * 2);
      const h = Math.max(32, hostH);
      if (w < 32 || h < 32) return;

      const hostAspect = w / h;
      const refAspect = CANVAS_REF_W / CANVAS_REF_H;
      let stageW = CANVAS_REF_W;
      let stageH = CANVAS_REF_H;
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
        boxW: w,
        boxH: h,
        insetPx,
      });
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(host);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
      host.style.paddingLeft = "";
      host.style.paddingRight = "";
    };
  }, [className]);

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

  const slotStyle = {
    width: fit.boxW,
    height: fit.boxH,
    maxWidth: "100%",
    overflow: "hidden",
    flexShrink: 0,
  } as CSSProperties;

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
