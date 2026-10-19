"use client";

import { useEffect } from "react";

/** Разовый сброс старого автомасштаба 1080p (больше не используем). */
export function BbDisplayScaleCleanup() {
  useEffect(() => {
    document.documentElement.classList.remove("bb-scale-1080");
    try {
      localStorage.removeItem("bb_force_scale_1080");
    } catch {
      /* ignore */
    }
  }, []);
  return null;
}
