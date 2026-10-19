"use client";

export type ProfileMode = "public" | "train" | "cw";

const MODES: { id: ProfileMode; label: string; short: string }[] = [
  { id: "public", label: "Паблик", short: "паб" },
  { id: "train", label: "Тренировки", short: "трени" },
  { id: "cw", label: "Клановые войны", short: "кв" },
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
          <span className="profile-mode-short">{m.short}</span>
          <span className="profile-mode-full">{m.label}</span>
        </button>
      ))}
    </div>
  );
}
