"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import {
  MEDAL_SHELF_SLOTS,
  type ProfileMedalItem,
  type ProfileMedalSlot,
} from "@/lib/profileMedals";

type Props = {
  /** До 3 слотов; можно передать плоский список — добиваем до 3. */
  items?: ProfileMedalItem[];
  slots?: ProfileMedalSlot[];
};

type Tip = { text: string; x: number; y: number };

function toSlots(
  slots: ProfileMedalSlot[] | undefined,
  items: ProfileMedalItem[] | undefined
): ProfileMedalSlot[] {
  if (Array.isArray(slots) && slots.length) {
    const out = slots.slice(0, MEDAL_SHELF_SLOTS);
    while (out.length < MEDAL_SHELF_SLOTS) out.push(null);
    return out;
  }
  const list = Array.isArray(items) ? items.slice(0, MEDAL_SHELF_SLOTS) : [];
  const out: ProfileMedalSlot[] = [...list];
  while (out.length < MEDAL_SHELF_SLOTS) out.push(null);
  return out;
}

export function ProfileMedalShelf({ items, slots }: Props) {
  const row = toSlots(slots, items);
  const hasAny = row.some(Boolean);
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
        {!hasAny ? (
          <p className="profile-medal-shelf-empty">
            Полка пуста — выбери до 3 наград в «Кастомизация профиля → Награды».
          </p>
        ) : (
          <ul className="profile-medal-shelf-row">
            {row.map((m, i) => (
              <li
                key={m?.id || `empty-${i}`}
                className={`profile-medal-slot${m ? "" : " is-empty"}`}
              >
                {m ? (
                  <button
                    type="button"
                    data-medal-id={m.id}
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
                ) : (
                  <span className="profile-medal-slot-empty" aria-hidden />
                )}
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
