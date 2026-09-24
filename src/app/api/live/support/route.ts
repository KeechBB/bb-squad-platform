import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canReplySupportForUser } from "@/lib/support";
import type { AppRole } from "@/lib/roles";
import { liveSubscribe, supportStaffChannel } from "@/lib/liveBus";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.steamId) {
    return new Response("Unauthorized", { status: 401 });
  }
  const me = await prisma.user.findUnique({
    where: { steamId: session.user.steamId },
    select: { id: true, role: true, steamId: true },
  });
  if (!me) return new Response("Unauthorized", { status: 401 });
  if (!canReplySupportForUser(me.steamId, me.role as AppRole)) {
    return new Response("Forbidden", { status: 403 });
  }

  const channel = supportStaffChannel();
  const encoder = new TextEncoder();
  let cleanup = () => {};

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: string) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${data}\n\n`)
        );
      };
      send("hello", JSON.stringify({ ok: true }));
      cleanup = liveSubscribe(channel, (payload) =>
        send("support", payload)
      );
      const ping = setInterval(() => {
        try {
          send("ping", String(Date.now()));
        } catch {
          clearInterval(ping);
        }
      }, 15000);
      req.signal.addEventListener("abort", () => {
        clearInterval(ping);
        cleanup();
        try {
          controller.close();
        } catch {
          /* */
        }
      });
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
