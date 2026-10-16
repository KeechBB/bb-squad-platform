/**
 * Telegram alerts via Cloudflare Worker relay (VPS cannot reach api.telegram.org).
 * Env: BB_TG_RELAY_URL, BB_TG_RELAY_SECRET, BB_TG_CHAT_ID
 */
function mskStamp(): string {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date()) + " МСК";
}

export async function sendBbAlert(text: string): Promise<boolean> {
  const relay = (process.env.BB_TG_RELAY_URL || "").trim().replace(/\/$/, "");
  const secret = (process.env.BB_TG_RELAY_SECRET || "").trim();
  const chat = (process.env.BB_TG_CHAT_ID || "").trim();
  if (!relay || !secret || !chat) {
    console.warn("bbAlerts: relay env missing — skip");
    return false;
  }
  try {
    const res = await fetch(`${relay}/`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "Mozilla/5.0 (compatible; BB-Squad-Alert/1.0)",
        "x-relay-secret": secret,
      },
      body: JSON.stringify({ secret, chat_id: chat, text: text.slice(0, 3900) }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error("bbAlerts relay fail", res.status, body.slice(0, 200));
      return false;
    }
    return true;
  } catch (e) {
    console.error("bbAlerts error", e);
    return false;
  }
}

export async function alertNewRegistration(opts: {
  nick: string;
  name: string;
  steamId: string;
  regNo?: number | null;
}): Promise<void> {
  const lines = [
    "✅ Новый участник на сайте",
    `📅 ${mskStamp()}`,
    `🏷 тип: регистрация`,
    "———",
    `• ник: ${opts.nick}`,
    `• имя: ${opts.name}`,
    `• Steam: ${opts.steamId}`,
  ];
  if (opts.regNo != null) lines.push(`• №: ${opts.regNo}`);
  await sendBbAlert(lines.join("\n"));
}

export async function alertSupportTicket(opts: {
  number: number;
  nick: string;
  preview: string;
}): Promise<void> {
  const lines = [
    "🆘 Новое обращение в поддержку",
    `📅 ${mskStamp()}`,
    "🏷 тип: поддержка",
    "———",
    `• тикет: #${opts.number}`,
    `• от: ${opts.nick}`,
    `• текст: ${opts.preview}`,
  ];
  await sendBbAlert(lines.join("\n"));
}

export async function alertClanLeft(opts: {
  nick: string;
  clan: string;
  how: "вышел" | "кик" | "убран";
  by?: string | null;
}): Promise<void> {
  const title =
    opts.how === "кик"
      ? "Кик из клана"
      : opts.how === "убран"
        ? "Убран из состава"
        : "Выход из клана";
  const lines = [
    `🚪 ${title}`,
    `📅 ${mskStamp()}`,
    "🏷 тип: состав",
    "———",
    `• ник: ${opts.nick}`,
    `• клан: ${opts.clan}`,
  ];
  if (opts.by) lines.push(`• кто: ${opts.by}`);
  await sendBbAlert(lines.join("\n"));
}

export async function alertTierChange(opts: {
  nick: string;
  move: string;
  actor?: string | null;
}): Promise<void> {
  const lines = [
    "🎖 Смена тира",
    `📅 ${mskStamp()}`,
    "🏷 тип: тир",
    "———",
    `• ник: ${opts.nick}`,
    `• перевод: ${opts.move}`,
  ];
  if (opts.actor) lines.push(`• кто: ${opts.actor}`);
  await sendBbAlert(lines.join("\n"));
}
