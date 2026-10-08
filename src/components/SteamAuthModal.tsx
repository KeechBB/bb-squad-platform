"use client";

import { signIn } from "next-auth/react";

type Props = {
  open: boolean;
  onClose: () => void;
  callbackUrl?: string;
  title?: string;
  message?: string;
};

export function SteamAuthModal({
  open,
  onClose,
  callbackUrl = "/",
  title = "Нужен вход через Steam",
  message = "Чтобы открыть этот раздел, авторизуйтесь через Steam.",
}: Props) {
  if (!open) return null;
  return (
    <div
      className="bb-auth-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="bb-auth-modal-title"
      onClick={onClose}
    >
      <div
        className="bb-auth-modal-card"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="bb-auth-modal-x"
          aria-label="Закрыть"
          onClick={onClose}
        >
          ×
        </button>
        <h2 id="bb-auth-modal-title">{title}</h2>
        <p className="muted">{message}</p>
        <button
          type="button"
          className="btn primary"
          onClick={() => void signIn("steam", { callbackUrl })}
        >
          Войти через Steam
        </button>
      </div>
    </div>
  );
}
