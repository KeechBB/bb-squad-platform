"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { ageFromBirthDate, formatBirthDateInput } from "@/lib/validation";

export function RegisterForm() {
  const router = useRouter();
  const { data: session, update } = useSession();
  const [name, setName] = useState("");
  const [nick, setNick] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const previewAge = useMemo(
    () => (birthDate.length === 10 ? ageFromBirthDate(birthDate) : null),
    [birthDate]
  );

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
          birthDate,
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
        <span>Ник</span>
        <input
          value={nick}
          onChange={(e) => setNick(e.target.value)}
          placeholder="Keech"
          maxLength={24}
          required
        />
        <span className="field-hint">
          Это ваш игровой никнейм. Можно латиницу, цифры и символы (без кириллицы).
        </span>
      </label>
      <label className="field">
        <span>Имя</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Как вас зовут"
          maxLength={40}
          required
        />
        <span className="field-hint">Как вас зовут в жизни / как обращаться.</span>
      </label>
      <label className="field">
        <span>Дата рождения</span>
        <input
          type="text"
          inputMode="numeric"
          autoComplete="bday"
          placeholder="ДД.ММ.ГГГГ"
          value={birthDate}
          onChange={(e) => setBirthDate(formatBirthDateInput(e.target.value))}
          maxLength={10}
          required
        />
        <span className="field-hint">
          Формат ДД.ММ.ГГГГ, точки можно ставить. Возраст посчитается сам
          {previewAge != null ? `: ${previewAge} лет` : " (от 14 до 99)"}.
        </span>
      </label>
      {error ? <p className="error">{error}</p> : null}
      <button className="btn primary" type="submit" disabled={loading}>
        {loading ? "Сохраняем…" : "Создать аккаунт"}
      </button>
    </form>
  );
}
