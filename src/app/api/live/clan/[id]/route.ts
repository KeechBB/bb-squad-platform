import { liveSubscribe } from "@/lib/liveBus";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const channel = `clan:${id}`;
  const encoder = new TextEncoder();

  let unsub = () => {};
  let ping: ReturnType<typeof setInterval> | null = null;
  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: string) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${data}\n\n`));
      };
      send("hello", JSON.stringify({ ok: true, t: Date.now() }));

      unsub = liveSubscribe(channel, (payload) => {
        send("clan", payload);
      });

      ping = setInterval(() => {
        try {
          send("ping", String(Date.now()));
        } catch {
          if (ping) clearInterval(ping);
          ping = null;
        }
      }, 15000);

      const close = () => {
        if (ping) clearInterval(ping);
        ping = null;
        unsub();
        try {
          controller.close();
        } catch {
          /* */
        }
      };

      req.signal.addEventListener("abort", close);
    },
    cancel() {
      if (ping) clearInterval(ping);
      ping = null;
      unsub();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
