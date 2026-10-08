/**
 * Cloudflare Worker: bb-squad-alert
 * Paste into Edit code → Deploy.
 *
 * Secrets (Settings → Variables → Encrypt):
 *   BOT_TOKEN, RELAY_SECRET, CHAT_ID
 */
export default {
  async fetch(request, env) {
    if (request.method === "GET") {
      return new Response(
        JSON.stringify({
          ok: true,
          service: "bb-squad-alert",
          hasBot: Boolean(env.BOT_TOKEN),
          hasSecret: Boolean(env.RELAY_SECRET),
          hasChat: Boolean(env.CHAT_ID),
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
