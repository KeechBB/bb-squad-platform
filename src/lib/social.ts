/** Discord / Telegram helpers for profile contacts */

const DISCORD_SNOWFLAKE = /^\d{17,20}$/;
const DISCORD_USER_URL = /(?:https?:\/\/)?(?:www\.)?discord(?:app)?\.com\/users\/(\d{17,20})/i;
const DISCORD_TAG = /^(?:.{2,32}#\d{4}|[a-z0-9._]{2,32})$/i;
const TELEGRAM_USER = /^[a-zA-Z][a-zA-Z0-9_]{4,31}$/;
const TELEGRAM_URL = /(?:https?:\/\/)?(?:t\.me|telegram\.me)\/([a-zA-Z][a-zA-Z0-9_]{4,31})/i;

export type DiscordContact = {
  tag: string | null;
  id: string | null;
};

export function parseDiscordInput(raw: string): DiscordContact | { error: string } {
  const t = raw.trim();
  if (!t) return { tag: null, id: null };

  const fromUrl = DISCORD_USER_URL.exec(t);
  if (fromUrl) {
    return { tag: null, id: fromUrl[1] };
  }
  if (DISCORD_SNOWFLAKE.test(t)) {
    return { tag: null, id: t };
  }

  const tag = t.replace(/^@/, "");
  if (!DISCORD_TAG.test(tag)) {
    return {
      error:
        "Discord: ник (user или user#0000) или ссылка discord.com/users/ID",
    };
  }
  return { tag, id: null };
}

export function parseTelegramInput(raw: string): { username: string | null } | { error: string } {
  const t = raw.trim();
  if (!t) return { username: null };

  const fromUrl = TELEGRAM_URL.exec(t);
  const username = (fromUrl ? fromUrl[1] : t.replace(/^@/, "")).trim();
  if (!TELEGRAM_USER.test(username)) {
    return {
      error: "Telegram: @username (5–32 символа, латиница/цифры/_)",
    };
  }
  return { username };
}

export function discordProfileUrl(id: string | null | undefined): string | null {
  if (!id || !DISCORD_SNOWFLAKE.test(id)) return null;
  return `https://discord.com/users/${id}`;
}

export function telegramProfileUrl(username: string | null | undefined): string | null {
  if (!username) return null;
  const u = username.replace(/^@/, "");
  if (!TELEGRAM_USER.test(u)) return null;
  return `https://t.me/${u}`;
}

export function formatDiscordDisplay(
  tag: string | null | undefined,
  id: string | null | undefined
): string {
  if (tag) return tag.startsWith("@") ? tag : tag;
  if (id) return `ID ${id}`;
  return "";
}

export function formatTelegramDisplay(username: string | null | undefined): string {
  if (!username) return "";
  return username.startsWith("@") ? username : `@${username}`;
}
