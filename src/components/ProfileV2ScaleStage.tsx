"use client";

import { type ReactNode } from "react";
import {
  CanvasScaleStage,
  CANVAS_REF_W,
  CANVAS_REF_H,
} from "@/components/CanvasScaleStage";

export const PROFILE_V2_REF_W = CANVAS_REF_W;
export const PROFILE_V2_REF_H = CANVAS_REF_H;

type Props = {
  children: ReactNode;
  hasBg?: boolean;
  contentWidth?: number;
};

/** Профиль: сцена 2K, контент 1600px по центру — бока под фон. */
export function ProfileV2ScaleStage({ children, hasBg = false, contentWidth = 1600 }: Props) {
  return (
    <CanvasScaleStage hasBg={hasBg} contentWidth={contentWidth} className="is-profile">
      {children}
    </CanvasScaleStage>
  );
}
