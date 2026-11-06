"use client";

import { KvAutoHeightFrame } from "@/components/KvAutoHeightFrame";

type Props = {
  iframeSrc: string;
  /** @deprecated Тиры FIT убраны с публичного UI */
  fitIframeSrc?: string;
  /** @deprecated */
  board?: unknown;
};

/** Хаб /tm — только матчи (рейтинг/аналитика внутри KV iframe). */
export function TrainingMatchesHub({ iframeSrc }: Props) {
  return (
    <div className="tm-hub is-matches">
      <KvAutoHeightFrame
        className="tm-hub-embed"
        src={iframeSrc}
        title="Тренировочные матчи BlackBerry"
      />
    </div>
  );
}
