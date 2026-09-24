"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { AppRole } from "@/lib/roles";
import { roleLabel } from "@/lib/roles";
import {
  formatDiscordDisplay,
  formatTelegramDisplay,
} from "@/lib/social";

type Props = {
  user: {
    id: string;
    steamId: string;
    steamName: string | null;
    name: string | null;
    nick: string | null;
    age: number | null;
    birthDate: string | null;
    role: AppRole;
    avatarUrl: string | null;
    createdAt: string;
    discordTag: string | null;
    discordId: string | null;
    telegram: string | null;
  };
  canEditProfile: boolean;
  canEditRole: boolean;
  roleOptions: AppRole[];
};

export function AdminUserEditForm({
  user,
  canEditProfile,
  canEditRole,
  roleOptions,
}: Props) {
  const router = useRouter();
  const [name, setName] = useState(user.name || "");
  const [nick, setNick] = useState(user.nick || "");
  const [birthDate, setBirthDate] = useState(user.birthDate || "");
  const [age, setAge] = useState(user.age != null ? String(user.age) : "");
  const [steamId, setSteamId] = useState(user.steamId);
  const [discord, setDiscord] = useState(
    formatDiscordDisplay(user.discordTag, user.discordId) ||
      (user.discordId ? user.discordId : "")
  );
  const [telegram, setTelegram] = useState(
    formatTelegramDisplay(user.telegram).replace(/^@/, "") || ""
  );
  const [role, setRole] = useState<AppRole>(
    roleOptions.includes(user.role) ? user.role : roleOptions[0] || "USER"
  );
  const [avatarUrl, setAvatarUrl] = useState(user.avatarUrl);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canEditProfile) return;
    setError("");
    setOk("");
    setLoading(true);
    try {
      const payload: Record<string, unknown> = {
        name,
        nick,
        steamId,
        discord,
        telegram,
      };
      if (birthDate) {
        payload.birthDate = birthDate;
      } else {
        payload.age = Number(age);
      }
      if (canEditRole) payload.role = role;

      const res = await fetch(`/api/admin/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Ошибка сохранения");
        return;
      }
      setOk("Сохранено");
      if (data.user?.age != null) setAge(String(data.user.age));
      if (data.user) {
        setDiscord(
          formatDiscordDisplay(data.user.discordTag, data.user.discordId) ||
            (data.user.discordId ? data.user.discordId : "")
        );
        setTelegram(
          formatTelegramDisplay(data.user.telegram).replace(/^@/, "") || ""
        );
      }
      router.refresh();
    } catch {
      setError("Сеть или сервер недоступны");
    } finally {
      setLoading(false);
    }
  }

  async function clearAvatar() {
    if (!canEditProfile) return;
    setError("");
    setOk("");
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clearAvatar: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Не удалось сбросить аватар");
        return;
      }
      setAvatarUrl(null);
      setOk("Аватар сброшен");
      router.refresh();
    } catch {
      setError("Сеть или сервер недоступны");
    } finally {
      setLoading(false);
    }
  }

  const locked = !canEditProfile;

  return (
    <form className="card form" onSubmit={onSubmit}>
      <div className="admin-avatar-block">
        <p className="field-label">Аватар</p>
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="admin-user-avatar" src={avatarUrl} alt="" width={96} height={96} />
        ) : (
          <div className="admin-user-avatar admin-user-avatar-empty">нет</div>
        )}
        {avatarUrl && canEditProfile ? (
          <button
            type="button"
            className="btn ghost"
            disabled={loading}
            onClick={() => void clearAvatar()}
          >
            Удалить аватар
          </button>
        ) : null}
      </div>

      <p className="muted">
        Steam ник: {user.steamName || "—"} · id: <span className="mono">{user.id}</span>
      </p>
      <label className="field">
        <span>Ник (игровой)</span>
        <input
          value={nick}
          onChange={(e) => setNick(e.target.value)}
          maxLength={24}
          required
          disabled={locked}
        />
        <span className="field-hint">Латиница, цифры и символы, 3–24.</span>
      </label>
      <label className="field">
        <span>Имя</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={40}
          required
          disabled={locked}
        />
      </label>
      <label className="field">
        <span>Дата рождения</span>
        <input
          type="date"
          value={birthDate}
          onChange={(e) => setBirthDate(e.target.value)}
          max={new Date().toISOString().slice(0, 10)}
          disabled={locked}
        />
        <span className="field-hint">
          Если пусто — сохранится возраст ниже вручную.
        </span>
      </label>
      <label className="field">
        <span>Возраст</span>
        <input
          value={age}
          onChange={(e) => setAge(e.target.value)}
          inputMode="numeric"
          required={!birthDate}
          disabled={locked || Boolean(birthDate)}
        />
      </label>
      <label className="field">
        <span>Steam ID</span>
        <input
          value={steamId}
          onChange={(e) => setSteamId(e.target.value)}
          inputMode="numeric"
          required
          disabled={locked}
        />
      </label>
      <label className="field">
        <span>Discord</span>
        <input
          value={discord}
          onChange={(e) => setDiscord(e.target.value)}
          placeholder="ник, tag#0000 или discord.com/users/ID"
          maxLength={80}
          disabled={locked}
        />
        <span className="field-hint">
          Оставь пустым и сохрани — Discord сотрётся. Ссылка на профиль даст
          кликабельный ID.
        </span>
      </label>
      <label className="field">
        <span>Telegram</span>
        <input
          value={telegram}
          onChange={(e) => setTelegram(e.target.value)}
          placeholder="username или t.me/username"
          maxLength={40}
          disabled={locked}
        />
        <span className="field-hint">
          Без @ или с @ — без разницы. Пустое поле + сохранить = удалить ТГ.
        </span>
      </label>
      <label className="field">
        <span>Роль</span>
        {canEditRole && roleOptions.length > 0 ? (
          <select
            className="role-select"
            value={role}
            onChange={(e) => setRole(e.target.value as AppRole)}
          >
            {Array.from(new Set<AppRole>([user.role, ...roleOptions]))
              .filter((r) => r === user.role || roleOptions.includes(r))
              .map((r) => (
                <option key={r} value={r}>
                  {roleLabel(r)}
                </option>
              ))}
          </select>
        ) : (
          <input value={roleLabel(user.role)} readOnly disabled />
        )}
      </label>
      {error ? <p className="error">{error}</p> : null}
      {ok ? <p className="ok-msg">{ok}</p> : null}
      <div className="avatar-actions">
        {canEditProfile ? (
          <button type="submit" className="btn primary" disabled={loading}>
            {loading ? "…" : "Сохранить"}
          </button>
        ) : null}
        <Link className="btn ghost" href="/admin">
          ← К списку
        </Link>
      </div>
    </form>
  );
}
