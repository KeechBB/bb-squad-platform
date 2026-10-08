"use client";

import { signIn } from "next-auth/react";

type Props = {
  title: string;
  message: string;
};

/** Полноэкранная заглушка для гостя на /clans и /aim. */
export function GuestSteamGate({ title, message }: Props) {
  return (
    <main className="guest-steam-gate">
      <section className="card guest-steam-gate-card">
        <h1>{title}</h1>
        <p className="muted">{message}</p>
        <button
          type="button"
          className="btn primary"
          onClick={() => void signIn("steam", { callbackUrl: typeof window !== "undefined" ? window.location.pathname : "/" })}
        >
          Войти через Steam
        </button>
      </section>
    </main>
  );
}
