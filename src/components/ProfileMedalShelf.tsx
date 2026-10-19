"use client";

import type { ProfileMedalItem } from "@/lib/profileMedals";

type Props = {
  items: ProfileMedalItem[];
};

export function ProfileMedalShelf({ items }: Props) {
  return (
    <section
      className="profile-medal-shelf"
      aria-label="Полка наград"
    >
      <div className="profile-medal-shelf-head">
        <span>Награды</span>
        {items.length > 0 ? (
          <em>{items.length}</em>
        ) : null}
      </div>

      <div className="profile-medal-shelf-stage">
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
                  className={`profile-medal-item kind-${m.kind}`}
                  title={m.hover}
                  aria-label={m.hover}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={m.icon} alt="" width={56} height={56} />
                  <span className="profile-medal-name">{m.name}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="profile-medal-shelf-ledge" aria-hidden />
      </div>
    </section>
  );
}
