"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";

export function RegisterForm() {
  const router = useRouter();
  const { data: session, update } = useSession();
  const [name, setName] = useState("");
  const [nick, setNick] = useState("");
  const [age, setAge] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          nick,
          age: Number(age),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Ошибка");
        return;
      }
      await update({
        name: data.user.name,
        nick: data.user.nick,
        age: data.user.age,
        profileComplete: true,
      });
      router.push("/profile");
      router.refresh();
    } catch {
      setError("Сеть или сервер недоступны");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="card form" onSubmit={onSubmit}>
      <label className="field">
        <span>Steam ID</span>
        <input value={session?.user?.steamId || ""} readOnly disabled />
      </label>
      <label className="field">
        <span>Имя</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Как к тебе обращаться"
          maxLength={40}
          required
        />
      </label>
      <label className="field">
        <span>Ник на сайте (только латиница)</span>
        <input
          value={nick}
          onChange={(e) => setNick(e.target.value)}
          placeholder="Keech"
          pattern="[A-Za-z0-9_-]{3,20}"
          title="A–Z, a–z, 0–9, _ или -, 3–20 символов"
          maxLength={20}
          required
        />
      </label>
      <label className="field">
        <span>Возраст</span>
        <input
          type="number"
          min={14}
          max={99}
          value={age}
          onChange={(e) => setAge(e.target.value)}
          required
        />
      </label>
      {error ? <p className="error">{error}</p> : null}
      <button className="btn primary" type="submit" disabled={loading}>
        {loading ? "Сохраняем…" : "Создать аккаунт"}
      </button>
    </form>
  );
}
