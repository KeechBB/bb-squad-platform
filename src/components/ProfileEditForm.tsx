"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import {
  formatDiscordDisplay,
  formatTelegramDisplay,
} from "@/lib/social";
import { ProfileAccountCard, type ProfileClanLink } from "@/components/ProfileAccountCard";

type Props = {
  initial: {
    nick: string;
    discordTag: string | null;
    discordId: string | null;
    telegram: string | null;
    steamId: string;
    steamName: string | null;
    siteRole?: string;
    regNo?: number | null;
    clans?: ProfileClanLink[];
  };
  adminLink?: ReactNode;
};

export function ProfileEditForm({ initial, adminLink }: Props) {
  const router = useRouter();
  const { update } = useSession();
  const [editing, setEditing] = useState(false);
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

  function cancel() {
    setEditing(false);
    setError("");
    setOk("");
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
        nick: (data.user.nick as string) || saved.nick,
        discordTag: data.user.discordTag as string | null,
        discordId: data.user.discordId as string | null,
        telegram: data.user.telegram as string | null,
        steamId: saved.steamId,
        steamName: saved.steamName,
      };
      setSaved({ ...saved, ...next });
      setDiscord(
        formatDiscordDisplay(next.discordTag, next.discordId) ||
          (next.discordId ? next.discordId : "")
      );
      setTelegram(formatTelegramDisplay(next.telegram).replace(/^@/, "") || "");
      await update({
        nick: next.nick,
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
              discordTag: saved.discordTag,
              discordId: saved.discordId,
              telegram: saved.telegram,
              steamId: saved.steamId,
              steamName: saved.steamName,
              clans: initial.clans,
            }}
            headAction={
              <button type="button" className="btn ghost" onClick={() => setEditing(true)}>
                Изменить анкету
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
            <span>Игровой ник (Steam)</span>
            <input value={saved.nick} readOnly disabled />
            <span className="field-hint">
              Берётся из Steam. Чтобы сменить — поменяй persona name в Steam и
              зайди на сайт заново.
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
