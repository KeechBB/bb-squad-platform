import { NextResponse } from "next/server";
import { requireSiteVisitsAccess } from "@/lib/requireAdmin";
import { MAIL_IMAGE_MAX, detectMailImageMime, saveMailImage } from "@/lib/mailImage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const gate = await requireSiteVisitsAccess();
  if (gate.error) return gate.error;
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Нет файла" }, { status: 400 });
  }
  if (file.size <= 0 || file.size > MAIL_IMAGE_MAX) {
    return NextResponse.json({ error: "Картинка до 8 МБ" }, { status: 400 });
  }
  const buf = Buffer.from(await file.arrayBuffer());
  const mime = detectMailImageMime(buf);
  if (!mime) {
    return NextResponse.json(
      { error: "Нужен PNG, JPG, WEBP или GIF" },
      { status: 400 }
    );
  }
  const url = await saveMailImage(buf, mime);
  return NextResponse.json({ url });
}
