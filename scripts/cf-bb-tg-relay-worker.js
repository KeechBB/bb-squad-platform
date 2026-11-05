/**
 * Cloudflare Worker: bb-squad-alert
 * Paste into Edit code → Deploy.
 *
 * Secrets / vars (Settings → Variables):
 *   BOT_TOKEN        — алерт-бот (старый sendMessage)
 *   RELAY_SECRET     — общий секрет
 *   CHAT_ID          — дефолтный чат алертов
 *   RECRUIT_BOT_TOKEN — токен bb_RecruitBot (прокси Bot API)
 *
 * Режимы:
 * 1) GET  /  → health
 * 2) POST /  → JSON {secret, chat_id, text} → sendMessage (алерты сайта)
 * 3) ANY  /s/{RELAY_SECRET}/bot{TOKEN}/{method} → полный прокси api.telegram.org
 *    (нужен VPS: TELEGRAM_API_BASE=https://…workers.dev/s/{secret}/bot)
 */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // Полный Bot API proxy для recruit-bot (и др.)
    const proxy = path.match(/^\/s\/([^/]+)\/bot(.+)\/([^/]+)$/);
    if (proxy) {
      return proxyTelegram(request, env, proxy[1], proxy[2], proxy[3], url.search);
    }

    if (request.method === "GET") {
      return new Response(
        JSON.stringify({
          ok: true,
          service: "bb-squad-alert",
          hasBot: Boolean(env.BOT_TOKEN),
          hasSecret: Boolean(env.RELAY_SECRET),
          hasChat: Boolean(env.CHAT_ID),
          hasRecruit: Boolean(env.RECRUIT_BOT_TOKEN),
          proxy: "/s/{RELAY_SECRET}/bot{TOKEN}/{method}",
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
    if (request.method !== "POST") {
      return new Response("method not allowed", { status: 405 });
    }

    let body = {};
    try {
      body = await request.json();
    } catch {
      return new Response("bad json", { status: 400 });
    }

    const headerSecret = request.headers.get("X-Relay-Secret") || "";
    const secret = String(body.secret || headerSecret || "");
    const expected = String(env.RELAY_SECRET || "");
    if (!expected) {
      return new Response("no RELAY_SECRET on worker", { status: 500 });
    }
    if (secret !== expected) {
      return new Response("forbidden: bad RELAY_SECRET", { status: 403 });
    }

    const token = env.BOT_TOKEN;
    if (!token) return new Response("no BOT_TOKEN on worker", { status: 500 });

    const chatId = String(body.chat_id || env.CHAT_ID || "");
    const text = String(body.text || "").slice(0, 3900);
    if (!chatId || !text) {
      return new Response("chat_id/text required", { status: 400 });
    }

    const tg = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        disable_web_page_preview: true,
      }),
    });

    const raw = await tg.text();
    return new Response(raw, {
      status: tg.status,
      headers: { "content-type": "application/json" },
    });
  },
};

async function proxyTelegram(request, env, secret, token, method, search) {
  const expected = String(env.RELAY_SECRET || "");
  if (!expected || secret !== expected) {
    return new Response("forbidden: bad RELAY_SECRET", { status: 403 });
  }
  const allowed = [env.BOT_TOKEN, env.RECRUIT_BOT_TOKEN]
    .map((t) => String(t || "").trim())
    .filter(Boolean);
  if (allowed.length && !allowed.includes(token)) {
    return new Response("forbidden: token not allowlisted", { status: 403 });
  }
  if (!/^[A-Za-z0-9_]+$/.test(method)) {
    return new Response("bad method", { status: 400 });
  }

  const target = `https://api.telegram.org/bot${token}/${method}${search || ""}`;
  const init = { method: request.method, headers: {} };
  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = await request.arrayBuffer();
    const ct = request.headers.get("content-type");
    if (ct) init.headers["content-type"] = ct;
  }
  const tg = await fetch(target, init);
  const buf = await tg.arrayBuffer();
  return new Response(buf, {
    status: tg.status,
    headers: {
      "content-type": tg.headers.get("content-type") || "application/json",
    },
  });
}
