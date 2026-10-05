"use client";

import { FormEvent, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export function StagingGateForm() {
  const router = useRouter();
  const search = useSearchParams();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const res = await fetch("/api/staging-gate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        setError(res.status === 401 ? "Неверный пароль" : "Не удалось войти");
        setBusy(false);
        return;
      }
      const next = search.get("from") || "/";
      router.replace(next.startsWith("/") ? next : "/");
      router.refresh();
    } catch {
      setError("Сеть / сервер недоступны");
      setBusy(false);
    }
  }

  return (
    <form className="stg-gate-card" onSubmit={onSubmit}>
      <p className="stg-gate-eyebrow">Черновик · не прод</p>
      <h1 className="stg-gate-title">BlackBerry Staging</h1>
      <p className="stg-gate-sub">
        Введи пароль, чтобы открыть черновик сайта. Без пароля сюда никто не
        зайдёт.
      </p>
      <label className="stg-gate-label" htmlFor="stg-pass">
        Пароль
      </label>
      <input
        id="stg-pass"
        className="stg-gate-input"
        type="password"
        autoComplete="current-password"
        autoFocus
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        disabled={busy}
      />
      {error ? <p className="stg-gate-error">{error}</p> : null}
      <button className="stg-gate-btn" type="submit" disabled={busy || !password}>
        {busy ? "…" : "Открыть черновик"}
      </button>
    </form>
  );
}
