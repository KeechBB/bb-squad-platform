import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isAdmin, syncBuiltinAdmins } from "@/lib/admin";
import { liveSubscribe, siteLiveChannel } from "@/lib/liveBus";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** SSE для админки: посещаемость, журнал и др. */
export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.steamId) {
    return new Response("Unauthorized", { status: 401 });
  }
  await syncBuiltinAdmins();
  if (!(await isAdmin(session.user.steamId))) {
    return new Response("Forbidden", { status: 403 });
  }

  const channel = siteLiveChannel();
  const encoder = new TextEncoder();
  let cleanup = () => {};

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: string) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${data}\n\n`)
        );
      };
      send("hello", JSON.stringify({ ok: true, t: Date.now() }));
      cleanup = liveSubscribe(channel, (payload) => send("site", payload));
      const ping = setInterval(() => {
        try {
          send("ping", String(Date.now()));
        } catch {
          clearInterval(ping);
        }
      }, 15000);
      const close = () => {
        clearInterval(ping);
        cleanup();
        try {
          controller.close();
        } catch {
          /* */
        }
      };
      req.signal.addEventListener("abort", close);
    },
    cancel() {
      cleanup();
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
