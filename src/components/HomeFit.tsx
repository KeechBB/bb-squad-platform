"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";
import { isPhonePanCanvas } from "@/components/TouchCompact";

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
      document.documentElement.classList.remove("bb-compact");
      const pan = isPhonePanCanvas();
      document.documentElement.classList.toggle("bb-phone-pan", pan);

      // Телефон: канва 1920×1004 как на ПК, без сжатия — свайп по странице.
      if (pan) {
        board.style.setProperty("--home-scale", "1");
        board.style.setProperty("--home-hero-lift", "0px");
        board.style.setProperty("--home-hero-nudge-x", "0px");
        host.style.height = `${DESIGN_H}px`;
        host.style.width = `${DESIGN_W}px`;
        return;
      }

      const w = host.clientWidth;
      const h = host.clientHeight;
      if (w < 8 || h < 8) return;
      const scale = Math.min(w / DESIGN_W, h / DESIGN_H);
      if (!Number.isFinite(scale) || scale <= 0) return;
      board.style.setProperty("--home-scale", String(scale));
      board.style.setProperty("--home-hero-lift", "0px");
      board.style.setProperty("--home-hero-nudge-x", "0px");
      host.style.width = "";
      host.style.height = `${Math.round(DESIGN_H * scale)}px`;
      if (hub) return;
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
    const ro = new ResizeObserver(fit);
    ro.observe(host);
    window.addEventListener("resize", fit);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", fit);
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
