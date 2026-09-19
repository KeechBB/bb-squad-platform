"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

type Props = {
  user: {
    id: string;
    steamId: string;
    steamName: string | null;
    name: string | null;
    nick: string | null;
    age: number | null;
    createdAt: string;
  };
};

export function AdminUserEditForm({ user }: Props) {
  const router = useRouter();
  const [name, setName] = useState(user.name || "");
  const [nick, setNick] = useState(user.nick || "");
  const [age, setAge] = useState(user.age != null ? String(user.age) : "");
  const [steamId, setSteamId] = useState(user.steamId);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setOk("");
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          nick,
          age: Number(age),
          steamId,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Ошибка сохранения");
        return;
      }
      setOk("Сохранено");
      router.refresh();
    } catch {
      setError("Сеть или сервер недоступны");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="card form" onSubmit={onSubmit}>
      <p className="muted" style={{ marginTop: 0 }}>
        Steam ник: {user.steamName || "—"} · id: <span className="mono">{user.id}</span>
      </p>
      <label className="field">
        <span>Ник</span>
        <input
          value={nick}
          onChange={(e) => setNick(e.target.value)}
          pattern="[A-Za-z0-9_-]{3,20}"
          maxLength={20}
          required
        />
      </label>
      <label className="field">
        <span>Имя</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={40}
          required
        />
      </label>
      <label className="field">
        <span>Возраст</span>
        <input
          value={age}
          onChange={(e) => setAge(e.target.value)}
          inputMode="numeric"
          required
        />
      </label>
      <label className="field">
        <span>Steam ID</span>
        <input
          value={steamId}
          onChange={(e) => setSteamId(e.target.value)}
          inputMode="numeric"
          required
        />
      </label>
      {error ? <p className="error">{error}</p> : null}
      {ok ? <p className="ok">{ok}</p> : null}
      <div className="avatar-actions">
        <button type="submit" className="btn primary" disabled={loading}>
          {loading ? "…" : "Сохранить"}
        </button>
        <Link className="btn ghost" href="/admin">
          ← К списку
        </Link>
      </div>
    </form>
  );
}
