import { NextResponse } from "next/server";
import { loadNetChat, postNetChat } from "@/lib/netServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const data = await loadNetChat();
  if ("error" in data) {
    return NextResponse.json({ error: data.error }, { status: data.error === "Нужен вход" ? 401 : 400 });
  }
  return NextResponse.json(data);
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const text = body && typeof body === "object" ? String((body as { body?: string }).body || "") : "";
  const result = await postNetChat(text);
  if ("error" in result) {
    const status = result.error === "Нужен вход" ? 401 : 400;
    return NextResponse.json({ error: result.error }, { status });
  }
  return NextResponse.json(result);
}
