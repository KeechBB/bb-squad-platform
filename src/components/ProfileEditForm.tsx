"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { ageFromBirthDate, formatBirthDateInput } from "@/lib/validation";
import {
  discordProfileUrl,
  formatDiscordDisplay,
  formatTelegramDisplay,
  telegramProfileUrl,
} from "@/lib/social";

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

  const discordUrl = discordProfileUrl(saved.discordId);
  const tgUrl = telegramProfileUrl(saved.telegram);
  const discordLabel = formatDiscordDisplay(saved.discordTag, saved.discordId);
  const tgLabel = formatTelegramDisplay(saved.telegram);

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

  async function copyDiscord() {
    if (!discordLabel) return;
    try {
      await navigator.clipboard.writeText(discordLabel);
      setOk("Discord скопирован");
    } catch {
      setOk("");
    }
  }

  return (
    <section className="card">
      <div className="profile-edit-head">
        <h2>Аккаунт</h2>
        {!editing ? (
          <button type="button" className="btn ghost" onClick={() => setEditing(true)}>
            Редактировать
          </button>
        ) : null}
      </div>

      {!editing ? (
        <>
          <div className="meta-row">
            <span>Ник</span>
            <span>{saved.nick}</span>
          </div>
          <div className="meta-row">
            <span>Имя</span>
            <span>{saved.name}</span>
          </div>
          <div className="meta-row">
            <span>Возраст</span>
            <span>
              {saved.age ?? "—"}
              {saved.birthDate ? ` (др. ${saved.birthDate})` : ""}
            </span>
          </div>
          <div className="meta-row">
            <span>Discord</span>
            <span className="contact-cell">
              {discordLabel ? (
                <>
                  {discordUrl ? (
                    <a className="contact-link" href={discordUrl} target="_blank" rel="noreferrer">
                      {discordLabel}
                    </a>
                  ) : (
                    <span>{discordLabel}</span>
                  )}
                  <button type="button" className="btn-mini" onClick={() => void copyDiscord()}>
                    копировать
                  </button>
                </>
              ) : (
                "—"
              )}
            </span>
          </div>
          <div className="meta-row">
            <span>Telegram</span>
            <span className="contact-cell">
              {tgLabel && tgUrl ? (
                <a className="contact-link" href={tgUrl} target="_blank" rel="noreferrer">
                  {tgLabel}
                </a>
              ) : (
                tgLabel || "—"
              )}
            </span>
          </div>
          <div className="meta-row">
            <span>Steam ID</span>
            <span className="mono">{saved.steamId}</span>
          </div>
          <div className="meta-row">
            <span>Steam</span>
            <span>{saved.steamName || "—"}</span>
          </div>
          {ok ? <p className="ok-msg">{ok}</p> : null}
          {adminLink}
        </>
      ) : (
        <form className="form profile-edit-form" onSubmit={onSubmit}>
          <label className="field">
            <span>Ник</span>
            <input
              value={nick}
              onChange={(e) => setNick(e.target.value)}
              maxLength={24}
              required
            />
            <span className="field-hint">Игровой ник, латиница/цифры/символы, 3–24</span>
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
      )}
    </section>
  );
}
