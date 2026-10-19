"use client";

import { useState } from "react";
import type { ProfileMedalItem } from "@/lib/profileMedals";

type Props = {
  items: ProfileMedalItem[];
};

export function ProfileMedalShelf({ items }: Props) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const active = items.find((m) => m.id === activeId) || null;

  return (
    <section className="profile-medal-shelf" aria-label="Полка наград">
      <div className="profile-medal-shelf-stage">
        <span className="profile-medal-watermark" aria-hidden>
          Награды
        </span>
        {items.length === 0 ? (
          <p className="profile-medal-shelf-empty">
            Полка пуста — награды появятся с Battle Pass и других сезонов.
          </p>
        ) : (
          <ul className="profile-medal-shelf-row">
            {items.map((m) => (
              <li key={m.id} className="profile-medal-slot">
                <button
                  type="button"
                  className={`profile-medal-item kind-${m.kind}${
                    activeId === m.id ? " is-active" : ""
                  }`}
                  aria-label={m.hover}
                  onMouseEnter={() => setActiveId(m.id)}
                  onMouseLeave={() => setActiveId(null)}
                  onFocus={() => setActiveId(m.id)}
                  onBlur={() => setActiveId(null)}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={m.icon} alt="" width={80} height={80} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <p
          className={`profile-medal-reason${active ? " is-on" : ""}`}
          aria-live="polite"
        >
          {active ? active.hover : "\u00a0"}
        </p>
      </div>
    </section>
  );
}
