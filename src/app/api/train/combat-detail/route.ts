import { spawn } from "child_process";
import path from "path";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

function safeId(raw: string) {
  const id = raw.trim();
  if (!id || id.length > 80 || !/^[a-zA-Z0-9_-]+$/.test(id)) return "";
  return id;
}

/**
 * Training detail lines: who, when, how. Reads a cached card, and builds it
 * from the server log the first time. Does not change RP.
 */
export async function GET(req: Request) {
  const session = await getSession();
  if (!session?.user?.steamId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const nick = url.searchParams.get("nick")?.trim() || "";
  const matchId = safeId(url.searchParams.get("matchId") || "");
  if (!nick || !matchId) {
    return NextResponse.json({ error: "nick and matchId required" }, { status: 400 });
  }

  const root = process.cwd();
  const script = path.join(root, "scripts", "train_combat_card.py");
  const match = await new Promise<unknown>((resolve) => {
    const child = spawn(
      "python3",
      [script, "--id", matchId, "--nick", nick],
      { cwd: root, env: process.env }
    );
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, 90_000);
    child.stdout.on("data", (buf) => {
      out += buf.toString("utf8");
    });
    child.stderr.on("data", (buf) => {
      err += buf.toString("utf8");
      if (err.length > 4000) err = err.slice(-4000);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const line = out.trim().split("\n").filter(Boolean).pop() || "";
      try {
        const parsed = JSON.parse(line) as { match?: unknown };
        resolve(parsed.match ?? null);
      } catch {
        console.warn(
          "[train/combat-detail] parse fail",
          matchId,
          nick,
          "code",
          code,
          "stdout",
          line.slice(0, 200),
          "stderr",
          err.slice(-500)
        );
        resolve(null);
      }
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      console.warn("[train/combat-detail] spawn error", e);
      resolve(null);
    });
  });

  return NextResponse.json(
    {
      match:
        match && typeof match === "object"
          ? { ...(match as object), net: 0 }
          : null,
    },
    { headers: { "Cache-Control": "private, max-age=120" } }
  );
}
