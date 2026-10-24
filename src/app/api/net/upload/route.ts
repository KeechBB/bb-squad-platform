import { NextResponse } from "next/server";
import { saveNetAvatar, createNetTheme, createNetPost } from "@/lib/netServer";
import { NET_MAX_BYTES } from "@/lib/netMedia";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function asBlob(entry: FormDataEntryValue | null): Blob | null {
  if (!entry || typeof entry === "string") return null;
  if (typeof (entry as Blob).arrayBuffer !== "function") return null;
  return entry as Blob;
}

async function readBlob(blob: Blob): Promise<Buffer | { error: string }> {
  if (blob.size <= 0 || blob.size > NET_MAX_BYTES) return { error: "Файл до 50 МБ" };
  return Buffer.from(await blob.arrayBuffer());
}

export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Пустой запрос" }, { status: 400 });
  const kind = String(form.get("kind") || "");

  if (kind === "avatar") {
    const blob = asBlob(form.get("file"));
    if (!blob) return NextResponse.json({ error: "Выбери картинку" }, { status: 400 });
    const buf = await readBlob(blob);
    if ("error" in buf) return NextResponse.json(buf, { status: 400 });
    const result = await saveNetAvatar(buf);
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json(result);
  }

  if (kind === "theme") {
    const images: Buffer[] = [];
    for (const entry of form.getAll("images")) {
      const blob = asBlob(entry);
      if (!blob) continue;
      const buf = await readBlob(blob);
      if ("error" in buf) return NextResponse.json(buf, { status: 400 });
      images.push(buf);
    }
    const result = await createNetTheme(String(form.get("title") || ""), String(form.get("body") || ""), images);
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json(result);
  }

  if (kind === "post") {
    const blob = asBlob(form.get("file"));
    let file: Buffer | null = null;
    if (blob) {
      const buf = await readBlob(blob);
      if ("error" in buf) return NextResponse.json(buf, { status: 400 });
      file = buf;
    }
    const result = await createNetPost(String(form.get("body") || ""), file);
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json(result);
  }

  return NextResponse.json({ error: "Неизвестный тип" }, { status: 400 });
}
