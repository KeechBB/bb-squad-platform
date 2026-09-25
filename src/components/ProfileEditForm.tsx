"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { ageFromBirthDate, formatBirthDateInput } from "@/lib/validation";
import {
  formatDiscordDisplay,
  formatTelegramDisplay,
} from "@/lib/social";
import { ProfileAccountCard } from "@/components/ProfileAccountCard";

type Props = {
  initial: {
    nick: string;
    name: string;
    birthDate: string | null;
    age: number | null;
    discordTag: string | null;
    discordId: string | null;
    telegram: string | null;
    steamId: string;
    steamName: string | null;
    siteRole?: string;
    regNo?: number | null;
  };
  adminLink?: ReactNode;
};

function birthToInput(isoOrRu: string | null): string {
  if (!isoOrRu) return "";
  if (/^\d{2}\.\d{2}\.\d{4}$/.test(isoOrRu)) return isoOrRu;
  if (/^\d{4}-\d{2}-\d{2}$/.test(isoOrRu)) {
    const [y, m, d] = isoOrRu.split("-");
    return `${d}.${m}.${y}`;
  }
  return "";
}

export function ProfileEditForm({ initial, adminLink }: Props) {
  const router = useRouter();
  const { update } = useSession();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(initial.name);
  const [nick, setNick] = useState(initial.nick);
  const [birthDate, setBirthDate] = useState(birthToInput(initial.birthDate));
  const [discord, setDiscord] = useState(
    formatDiscordDisplay(initial.discordTag, initial.discordId) ||
      (initial.discordId ? initial.discordId : "")
  );
  const [telegram, setTelegram] = useState(
    formatTelegramDisplay(initial.telegram).replace(/^@/, "") || ""
  );
  const [saved, setSaved] = useState(initial);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [loading, setLoading] = useState(false);

  const previewAge = useMemo(
    () => (birthDate.length === 10 ? ageFromBirthDate(birthDate) : null),
    [birthDate]
  );

  function cancel() {
    setEditing(false);
    setError("");
    setOk("");
    setName(saved.name);
    setNick(saved.nick);
    setBirthDate(birthToInput(saved.birthDate));
    setDiscord(
      formatDiscordDisplay(saved.discordTag, saved.discordId) ||
        (saved.discordId ? saved.discordId : "")
    );
    setTelegram(formatTelegramDisplay(saved.telegram).replace(/^@/, "") || "");
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setOk("");
    setLoading(true);
    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          nick,
          birthDate,
          discord,
          telegram,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Не удалось сохранить");
        return;
      }
      const next = {
        nick: data.user.nick as string,
        name: data.user.name as string,
        birthDate: data.user.birthDate as string | null,
        age: data.user.age as number | null,
        discordTag: data.user.discordTag as string | null,
        discordId: data.user.discordId as string | null,
        telegram: data.user.telegram as string | null,
        steamId: saved.steamId,
        steamName: saved.steamName,
      };
      setSaved(next);
      setNick(next.nick);
      setName(next.name);
      setBirthDate(birthToInput(next.birthDate));
      setDiscord(
        formatDiscordDisplay(next.discordTag, next.discordId) ||
          (next.discordId ? next.discordId : "")
      );
      setTelegram(formatTelegramDisplay(next.telegram).replace(/^@/, "") || "");
      await update({
        name: next.name,
        nick: next.nick,
        age: next.age ?? undefined,
      });
      setOk("Сохранено");
      setEditing(false);
      router.refresh();
    } catch {
      setError("Сеть или сервер недоступны");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      {!editing ? (
        <>
          <ProfileAccountCard
            data={{
              nick: saved.nick,
              regNo: initial.regNo ?? null,
              siteRole: initial.siteRole || "Игрок",
              name: saved.name,
              age: saved.age,
              birthDate: saved.birthDate,
              discordTag: saved.discordTag,
              discordId: saved.discordId,
              telegram: saved.telegram,
              steamId: saved.steamId,
              steamName: saved.steamName,
            }}
            headAction={
              <button type="button" className="btn ghost" onClick={() => setEditing(true)}>
                Редактировать
              </button>
            }
          />
          {ok ? <p className="ok-msg">{ok}</p> : null}
          {adminLink}
        </>
      ) : (
        <section className="card">
          <div className="profile-edit-head">
            <h2>Аккаунт</h2>
          </div>
          <form className="form profile-edit-form" onSubmit={onSubmit}>
          <label className="field">
            <span>Ник</span>
            <input
              value={nick}
              onChange={(e) => setNick(e.target.value)}
              maxLength={24}
              required
            />
            <span className="field-hint">Игровой ник: латиница/цифры/символы/пробелы, 3–24</span>
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
              ДД.ММ.ГГГГ
              {previewAge != null ? ` · ${previewAge} лет` : " · возраст 14–99"}
            </span>
          </label>
          <label className="field">
            <span>Discord</span>
            <input
              value={discord}
              onChange={(e) => setDiscord(e.target.value)}
              placeholder="ник или discord.com/users/ID"
              maxLength={80}
            />
            <span className="field-hint">
              Ник, старый tag#0000 или ссылка на профиль — тогда будет кликабельная
              интеграция
            </span>
          </label>
          <label className="field">
            <span>Telegram</span>
            <input
              value={telegram}
              onChange={(e) => setTelegram(e.target.value)}
              placeholder="username или t.me/username"
              maxLength={40}
            />
            <span className="field-hint">Откроется как t.me/username</span>
          </label>
          {error ? <p className="error">{error}</p> : null}
          <div className="avatar-actions">
            <button type="submit" className="btn primary" disabled={loading}>
              {loading ? "…" : "Сохранить"}
            </button>
            <button type="button" className="btn ghost" onClick={cancel} disabled={loading}>
              Отмена
            </button>
          </div>
        </form>
        </section>
      )}
    </>
  );
}
