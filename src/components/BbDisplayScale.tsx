"use client";

import { useEffect } from "react";

const CLASS = "bb-scale-1080";
const KEY = "bb_force_scale_1080";

/**
 * На экранах 1920×1080 сайт визуально как browser zoom 75%
 * (браузерный зум страницам выставить нельзя).
 * localStorage bb_force_scale_1080=0|1 — ручной override.
 */
function shouldScale1080(): boolean {
  try {
    const forced = localStorage.getItem(KEY);
    if (forced === "0") return false;
    if (forced === "1") return true;
  } catch {
    /* ignore */
  }
  if (typeof window === "undefined") return false;
  const w = window.screen?.width || 0;
  const h = window.screen?.height || 0;
  // классический Full HD (и частые варианты с панелью задач / масштабом ОС)
  return w === 1920 && (h === 1080 || h === 1040 || h === 1050 || h === 1032);
}

export function BbDisplayScale() {
  useEffect(() => {
    const root = document.documentElement;
    const apply = () => {
      if (shouldScale1080()) root.classList.add(CLASS);
      else root.classList.remove(CLASS);
    };
    apply();
    window.addEventListener("resize", apply);
    // смена монитора / вынос окна
    const mq = window.matchMedia("(min-resolution: 1dppx)");
    mq.addEventListener?.("change", apply);
    return () => {
      window.removeEventListener("resize", apply);
      mq.removeEventListener?.("change", apply);
      root.classList.remove(CLASS);
    };
  }, []);

  return null;
}
