"use client";

export type ProfileMode = "public" | "train" | "cw";

const MODES: { id: ProfileMode; label: string }[] = [
  { id: "public", label: "Профиль паблика" },
  { id: "train", label: "Профиль Тренировок" },
  { id: "cw", label: "Профиль Клановых войн" },
];

type Props = {
  value: ProfileMode;
  onChange: (mode: ProfileMode) => void;
};

export function ProfileModeSwitch({ value, onChange }: Props) {
  return (
    <div
      className="profile-mode-switch"
      role="tablist"
      aria-label="Режим профиля"
    >
      {MODES.map((m) => (
        <button
          key={m.id}
          type="button"
          role="tab"
          aria-selected={value === m.id}
          className={`profile-mode-pill profile-mode-${m.id}${
            value === m.id ? " is-active" : ""
          }`}
          title={m.label}
          onClick={() => onChange(m.id)}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}
