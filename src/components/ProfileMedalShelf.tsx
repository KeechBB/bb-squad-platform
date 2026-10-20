"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import type { ProfileMedalItem } from "@/lib/profileMedals";

type Props = {
  items: ProfileMedalItem[];
};

type Tip = { text: string; x: number; y: number };

export function ProfileMedalShelf({ items }: Props) {
  const list = Array.isArray(items) ? items : [];
  const [activeId, setActiveId] = useState<string | null>(null);
  const [tip, setTip] = useState<Tip | null>(null);

  function showTip(el: HTMLElement, text: string) {
    const r = el.getBoundingClientRect();
    setTip({ text, x: r.left + r.width / 2, y: r.top });
  }

  return (
    <section className="profile-medal-shelf" aria-label="Полка наград">
      <div className="profile-medal-shelf-stage">
        <span className="profile-medal-watermark" aria-hidden>
          Награды
        </span>
        {list.length === 0 ? (
          <p className="profile-medal-shelf-empty">
            Полка пуста — награды появятся с Battle Pass и других сезонов.
          </p>
        ) : (
          <ul className="profile-medal-shelf-row">
            {list.map((m) => (
              <li key={m.id} className="profile-medal-slot">
                <button
                  type="button"
                  className={`profile-medal-item kind-${m.kind}${
                    activeId === m.id ? " is-active" : ""
                  }`}
                  aria-label={m.hover}
                  onMouseEnter={(e) => {
                    setActiveId(m.id);
                    showTip(e.currentTarget, m.hover);
                  }}
                  onMouseLeave={() => {
                    setActiveId(null);
                    setTip(null);
                  }}
                  onFocus={(e) => {
                    setActiveId(m.id);
                    showTip(e.currentTarget, m.hover);
                  }}
                  onBlur={() => {
                    setActiveId(null);
                    setTip(null);
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={m.icon} alt="" width={80} height={80} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
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
    </section>
  );
}
