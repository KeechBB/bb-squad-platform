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
};

/** Профиль: сцена 2K, контент 1600px по центру — бока под фон. */
export function ProfileV2ScaleStage({ children, hasBg = false }: Props) {
  return (
    <CanvasScaleStage hasBg={hasBg} contentWidth={1600} className="is-profile">
      {children}
    </CanvasScaleStage>
  );
}
