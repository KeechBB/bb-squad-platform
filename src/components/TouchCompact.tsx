"use client";

import { useEffect } from "react";
import { isMobileLayout } from "@/lib/mobileLayout";

/** Compatibility exports; compact layout is now driven by CSS width. */
export const isTouchCompact = isMobileLayout;
export function isPhonePanCanvas(): boolean { return false; }

export function TouchCompact() {
  useEffect(() => {
    document.documentElement.classList.remove("bb-compact", "bb-phone-pan", "bb-hub-phone");
  }, []);
  return null;
}
