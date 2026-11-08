"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";
import { isMobileLayout } from "@/lib/mobileLayout";

/** Design canvas: the desktop 4-column home. Scaled to the live viewport. */
const DESIGN_W = 1920;
const DESIGN_H = 1004;

export function HomeFit({
  children,
  hub = false,
}: {
  children: ReactNode;
  /** Hub rebrand: no hero-brand centering math. */
  hub?: boolean;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const host = hostRef.current;
    const board = boardRef.current;
    if (!host || !board) return;

    const fit = () => {
      if (isMobileLayout()) {
        board.style.removeProperty("--home-scale");
        host.style.width = "";
        host.style.height = "";
        host.style.overflow = "";
        return;
      }

      if (hub) {
        // канва + фон оболочки в одном слое (пазы не разъезжаются)
        host.style.width = "100%";
        host.style.height = "100%";
        host.style.overflow = "hidden";
      }

      const w = host.clientWidth;
      const h = host.clientHeight;
      if (w < 8 || h < 8) return;
      const scale = hub
        ? Math.max(w / DESIGN_W, h / DESIGN_H)
        : Math.min(w / DESIGN_W, h / DESIGN_H);
      if (!Number.isFinite(scale) || scale <= 0) return;
      board.style.setProperty("--home-scale", String(scale));
      board.style.setProperty("--home-hero-lift", "0px");
      board.style.setProperty("--home-hero-nudge-x", "0px");
      if (hub) return;
      host.style.width = "";
      host.style.height = `${Math.round(DESIGN_H * scale)}px`;
      const brand = board.querySelector<HTMLElement>(".home-hero-brand");
      const side = board.querySelector<HTMLElement>(".home-side");
      if (brand && side) {
        const brandRect = brand.getBoundingClientRect();
        const sideRect = side.getBoundingClientRect();
        const openRight = window.innerWidth;
        const targetX = sideRect.right + (openRight - sideRect.right) / 2;
        const targetY = window.innerHeight / 2;
        const brandCx = brandRect.left + brandRect.width / 2;
        const brandCy = brandRect.top + brandRect.height / 2;
        const nudgeX = (brandCx - targetX) / scale;
        const lift = (brandCy - targetY) / scale;
        board.style.setProperty("--home-hero-nudge-x", `${nudgeX}px`);
        board.style.setProperty("--home-hero-lift", `${lift}px`);
      }
    };

    fit();
    // Measure again after the initial layout.
    const raf = window.requestAnimationFrame(() => {
      fit();
      window.requestAnimationFrame(fit);
    });
    const ro = new ResizeObserver(fit);
    ro.observe(host);
    window.addEventListener("resize", fit);
    window.visualViewport?.addEventListener("resize", fit);
    return () => {
      window.cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("resize", fit);
      window.visualViewport?.removeEventListener("resize", fit);
    };
  }, [hub]);

  return (
    <div className="home-fit" ref={hostRef}>
      <div className={`home-layout${hub ? " is-hub" : ""}`} ref={boardRef}>
        {children}
      </div>
    </div>
  );
}
