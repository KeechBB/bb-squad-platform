"use client";

import { useEffect } from "react";

/**
 * Телефон = ПК-канва 1:1 + свайп пальцем.
 * Компактный одноколоночный reflow отключён — он ломал «как на мониторе».
 */
export function isTouchCompact(): boolean {
  return false;
}

/** Узкий тач-экран: не сжимаем HomeFit, даём pan по 1920-канве. */
export function isPhonePanCanvas(): boolean {
  if (typeof window === "undefined") return false;
  const touch = navigator.maxTouchPoints > 0 || window.matchMedia("(pointer: coarse)").matches;
  if (!touch) return false;
  const shortSide = Math.min(window.screen.width, window.screen.height);
  return shortSide <= 900;
}

export function TouchCompact() {
  useEffect(() => {
    const root = document.documentElement;
    const sync = () => {
      root.classList.remove("bb-compact");
      root.classList.toggle("bb-phone-pan", isPhonePanCanvas());
    };
    sync();
    window.addEventListener("resize", sync);
    window.visualViewport?.addEventListener("resize", sync);
    return () => {
      window.removeEventListener("resize", sync);
      window.visualViewport?.removeEventListener("resize", sync);
      root.classList.remove("bb-compact");
      root.classList.remove("bb-phone-pan");
    };
  }, []);
  return null;
}
