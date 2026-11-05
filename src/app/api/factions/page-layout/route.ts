import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Раскладка хранится у страницы фракции, отдельно для каждого человека. */
export async function GET() {
  return NextResponse.json({ error: "not_found" }, { status: 404 });
}

export async function POST() {
  return NextResponse.json({ error: "not_found" }, { status: 404 });
}
