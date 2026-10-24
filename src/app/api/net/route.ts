import { NextResponse } from "next/server";
import { loadNetPage, setNetStatus, setNetBg, voteNetTheme, deleteNetTheme, voteNetPost, deleteNetPost, deleteNetComment, deleteNetThemeComment, commentNetPost, commentNetTheme, setNetFollow, createNetNews } from "@/lib/netServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const nick = new URL(req.url).searchParams.get("nick") || "";
  const data = await loadNetPage(nick);
  if ("error" in data) {
    return NextResponse.json({ error: data.error }, { status: data.status });
  }
  return NextResponse.json(data);
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const action = body && typeof body === "object" ? (body as { action?: string }).action : "";
  const b = (body || {}) as Record<string, unknown>;

  const run = async () => {
    if (action === "status") return setNetStatus(String(b.text || ""));
    if (action === "bg") return setNetBg(typeof b.bgId === "string" ? b.bgId : null);
    if (action === "vote") {
      const value = b.value === 1 || b.value === -1 || b.value === 0 ? b.value : null;
      if (!value && value !== 0) return { error: "Некорректный голос" };
      return voteNetTheme(String(b.id || ""), value);
    }
    if (action === "delete-theme") return deleteNetTheme(String(b.id || ""));
    if (action === "like") {
      const value = b.value === 1 || b.value === -1 || b.value === 0 ? b.value : null;
      if (value === null) return { error: "Некорректный голос" };
      return voteNetPost(String(b.id || ""), value);
    }
    if (action === "delete-post") return deleteNetPost(String(b.id || ""));
    if (action === "delete-comment") return deleteNetComment(String(b.id || ""));
    if (action === "delete-theme-comment") return deleteNetThemeComment(String(b.id || ""));
    if (action === "comment") return commentNetPost(String(b.postId || ""), String(b.body || ""));
    if (action === "comment-theme") return commentNetTheme(String(b.themeId || ""), String(b.body || ""));
    if (action === "follow") return setNetFollow(String(b.nick || ""), Boolean(b.on));
    if (action === "news") return createNetNews(String(b.title || ""), String(b.body || ""));
    return { error: "Неизвестное действие" };
  };

  const result = await run();
  if ("error" in result) {
    const status = result.error === "Нужен вход" ? 401 : 400;
    return NextResponse.json({ error: result.error }, { status });
  }
  return NextResponse.json(result);
}
