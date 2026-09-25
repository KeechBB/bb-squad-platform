import type { ReactNode } from "react";
import {
  discordProfileUrl,
  formatDiscordDisplay,
  formatTelegramDisplay,
  telegramProfileUrl,
} from "@/lib/social";

export type ProfileAccountFields = {
  nick: string;
  regNo: number | null;
  siteRole: string;
  name: string;
  age: number | null;
  birthDate?: string | null;
  discordTag: string | null;
  discordId: string | null;
  telegram: string | null;
  steamId: string;
  steamName: string | null;
};

type Props = {
  data: ProfileAccountFields;
  /** Кнопка справа в шапке (только свой профиль) */
  headAction?: ReactNode;
};

export function ProfileAccountCard({ data, headAction }: Props) {
  const discordLabel = formatDiscordDisplay(data.discordTag, data.discordId);
  const discordUrl = discordProfileUrl(data.discordId);
  const tgLabel = formatTelegramDisplay(data.telegram);
  const tgUrl = telegramProfileUrl(data.telegram);

  return (
    <section className="card profile-account-card">
      <div className="profile-edit-head">
        <h2>Аккаунт</h2>
        {headAction || <span className="profile-edit-head-spacer" aria-hidden="true" />}
      </div>
      <div className="profile-account-meta">
        <div className="meta-row">
          <span>Ник</span>
          <span>{data.nick || "—"}</span>
        </div>
        <div className="meta-row">
          <span>№ регистрации</span>
          <span>{data.regNo ?? "—"}</span>
        </div>
        <div className="meta-row">
          <span>Роль на сайте</span>
          <span>{data.siteRole || "Игрок"}</span>
        </div>
        <div className="meta-row">
          <span>Имя</span>
          <span>{data.name || "—"}</span>
        </div>
        <div className="meta-row">
          <span>Возраст</span>
          <span>
            {data.age ?? "—"}
            {data.birthDate ? ` (др. ${data.birthDate})` : ""}
          </span>
        </div>
        <div className="meta-row">
          <span>Discord</span>
          <span className="contact-cell">
            {discordLabel ? (
              discordUrl ? (
                <a className="contact-link" href={discordUrl} target="_blank" rel="noreferrer">
                  {discordLabel}
                </a>
              ) : (
                discordLabel
              )
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
          <span className="mono">{data.steamId || "—"}</span>
        </div>
        <div className="meta-row">
          <span>Steam</span>
          <span>{data.steamName || "—"}</span>
        </div>
      </div>
    </section>
  );
}
