import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/requireAdmin";
import { userInReserve } from "@/lib/reserve";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function cell(v: string | number): string {
  if (typeof v === "number" && Number.isFinite(v)) {
    return `<Cell><Data ss:Type="Number">${v}</Data></Cell>`;
  }
  return `<Cell><Data ss:Type="String">${xmlEscape(String(v))}</Data></Cell>`;
}

/** Выгрузка пользователей: № | Ник | Имя | Steam ID | Статус резерва */
export async function GET() {
  const gate = await requireAdmin();
  if (gate.error) return gate.error;

  const users = await prisma.user.findMany({
    orderBy: [{ regNo: "asc" }, { createdAt: "asc" }],
    select: {
      regNo: true,
      nick: true,
      name: true,
      steamId: true,
      reserveUntil: true,
      profileComplete: true,
    },
  });

  const header = ["№ на сайте", "Ник", "Имя", "Steam ID", "Статус"];
  const rowsXml = users
    .map((u) => {
      const reserve = userInReserve(u);
      const status = !u.profileComplete
        ? "Анкета не завершена"
        : reserve
          ? "Резерв"
          : "Не резерв";
      const cells = [
        cell(u.regNo ?? ""),
        cell(u.nick || "—"),
        cell(u.name || "—"),
        cell(u.steamId),
        cell(status),
      ].join("");
      return `<Row>${cells}</Row>`;
    })
    .join("\n");

  const headerRow = `<Row>${header.map((h) => cell(h)).join("")}</Row>`;

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Styles>
  <Style ss:ID="hdr"><Font ss:Bold="1"/></Style>
 </Styles>
 <Worksheet ss:Name="Пользователи">
  <Table>
   ${headerRow}
   ${rowsXml}
  </Table>
 </Worksheet>
</Workbook>`;

  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `blackberry-users-${stamp}.xls`;

  return new NextResponse(xml, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.ms-excel; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
