import { NextResponse } from "next/server";
import {
  buildHomeCwPwrBoard,
  emptyHomeCwPwrBoard,
} from "@/lib/homeCwPwr";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const data = await buildHomeCwPwrBoard();
    return NextResponse.json(data);
  } catch {
    const empty = emptyHomeCwPwrBoard();
    return NextResponse.json(empty, { status: 200 });
  }
}
