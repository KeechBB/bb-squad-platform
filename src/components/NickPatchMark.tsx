"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import {
  normalizeProfilePatch,
  profilePatchTip,
  profilePatchUrl,
  type ProfilePatchId,
} from "@/lib/profilePatches";

type Props = {
  patchId: string | null | undefined;
  className?: string;
};

type Tip = { text: string; x: number; y: number };

/** Нашивка у ника в таблицах рейтинга. */
export function NickPatchMark({ patchId, className }: Props) {
  const id = normalizeProfilePatch(patchId);
  const url = profilePatchUrl(id);
  const [tip, setTip] = useState<Tip | null>(null);
  const [active, setActive] = useState(false);

  if (!id || !url) return null;
  const tipText = profilePatchTip(id);

  function show(el: HTMLElement) {
    const r = el.getBoundingClientRect();
    setTip({ text: tipText, x: r.left + r.width / 2, y: r.top });
    setActive(true);
  }

  function hide() {
    setTip(null);
    setActive(false);
  }

  return (
    <>
      <button
        type="button"
        className={`nick-patch-mark${active ? " is-active" : ""}${
          className ? ` ${className}` : ""
        }`}
        data-patch-id={id}
        aria-label={tipText}
        onMouseEnter={(e) => show(e.currentTarget)}
        onMouseLeave={hide}
        onFocus={(e) => show(e.currentTarget)}
        onBlur={hide}
        onClick={(e) => e.stopPropagation()}
      >
        <span
          className="nick-patch-mark-art"
          style={{ backgroundImage: `url(${url})` }}
          aria-hidden
        />
      </button>
      {tip && typeof document !== "undefined"
        ? createPortal(
            <div
              className="profile-medal-tip"
              style={{ left: tip.x, top: tip.y }}
              role="tooltip"
            >
              {tip.text}
            </div>,
            document.body
          )
        : null}
    </>
  );
}

export type { ProfilePatchId };
