import { CLAN_REAL_LABEL, clanMissingApprox } from "@/lib/bbClanHeadcount";
import type { BbTrainReportRow, BbTrainSlot } from "@/lib/bbTrainReport";

const W = 1680;
const PAD = 48;
const GAP = 16;

type Stat = { title: string; value: string; color: string };

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wrap(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxW: number
): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const word of words) {
    const next = cur ? `${cur} ${word}` : word;
    if (ctx.measureText(next).width > maxW && cur) {
      lines.push(cur);
      cur = word;
    } else {
      cur = next;
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
}

function paint(
  ctx: CanvasRenderingContext2D,
  row: BbTrainReportRow,
  when: string,
  draw: boolean
): number {
  const p = row.payload;
  const inner = W - PAD * 2;
  let y = 44;

  if (draw) {
    ctx.fillStyle = "#0c0e14";
    ctx.fillRect(0, 0, W, ctx.canvas.height);
    ctx.fillStyle = "#f8fafc";
    ctx.font = "700 46px Oxanium, Manrope, sans-serif";
    ctx.fillText("Отчет по BB", PAD, y + 40);
  }
  y += 64;
  if (draw) {
    ctx.fillStyle = "#a78bfa";
    ctx.font = "600 24px Manrope, sans-serif";
    ctx.fillText(when, PAD, y + 24);
  }
  y += 52;

  const cards = (
    items: Stat[],
    cols: number,
    top: number
  ): number => {
    const cardW = (inner - GAP * (cols - 1)) / cols;
    ctx.font = "600 18px Manrope, sans-serif";
    let maxLines = 1;
    for (const item of items) {
      maxLines = Math.max(maxLines, wrap(ctx, item.title, cardW - 36).length);
    }
    const cardH = 28 + maxLines * 24 + 56;
    if (draw) {
      items.forEach((item, i) => {
        const x = PAD + i * (cardW + GAP);
        ctx.fillStyle = "#161a24";
        ctx.strokeStyle = item.color;
        ctx.lineWidth = 3;
        roundRect(ctx, x, top, cardW, cardH, 16);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = "#cbd5e1";
        ctx.font = "600 18px Manrope, sans-serif";
        const lines = wrap(ctx, item.title, cardW - 36);
        lines.forEach((line, li) => {
          ctx.fillText(line, x + 18, top + 32 + li * 24);
        });
        ctx.fillStyle = item.color;
        ctx.font = "700 42px Oxanium, Manrope, sans-serif";
        ctx.fillText(item.value, x + 18, top + 32 + maxLines * 24 + 36);
      });
    }
    return top + cardH;
  };

  y = cards(
    [
      { title: "Пиковый онлайн сегодня", value: String(row.peakOnline), color: "#a78bfa" },
      {
        title: "Общее кол-во людей зашедших на тренировку сегодня",
        value: String(row.joinedTotal),
        color: "#4ade80",
      },
      {
        title: "На сервере, в клане нет",
        value: String(p.notInClan.length),
        color: "#fb923c",
      },
    ],
    3,
    y
  );
  y += 16;
  y = cards(
    [
      {
        title: "Всего людей в клане на сайте",
        value: p.clanOnSite ? String(p.clanOnSite) : "—",
        color: "#60a5fa",
      },
      { title: "Реально людей в клане", value: CLAN_REAL_LABEL, color: "#f0c987" },
      { title: "Не хватает", value: clanMissingApprox(p.clanOnSite), color: "#fb7185" },
    ],
    3,
    y
  );
  y += 28;

  const section = (
    title: string,
    names: string[],
    color: string,
    top: number,
    dash = true
  ): number => {
    let cy = top;
    if (draw) {
      ctx.fillStyle = color;
      ctx.font = "700 26px Manrope, sans-serif";
      const lines = wrap(ctx, title, inner);
      lines.forEach((line, i) => ctx.fillText(line, PAD, cy + 28 + i * 32));
      cy += lines.length * 32;
    } else {
      ctx.font = "700 26px Manrope, sans-serif";
      cy += wrap(ctx, title, inner).length * 32;
    }
    cy += 16;
    const list = names.length ? names : dash ? ["—"] : [];
    if (!list.length) return cy + 8;
    ctx.font = "700 22px Manrope, sans-serif";
    const padX = 16;
    const padY = 10;
    const chipGap = 10;
    let cx = PAD;
    let lineH = 0;
    for (const name of list) {
      const tw = ctx.measureText(name).width;
      const cw = Math.min(tw + padX * 2, inner);
      const ch = 22 + padY * 2;
      if (cx + cw > PAD + inner && cx > PAD) {
        cx = PAD;
        cy += lineH + chipGap;
        lineH = 0;
      }
      if (draw && name !== "—") {
        ctx.fillStyle = "#1f2433";
        roundRect(ctx, cx, cy, cw, ch, 10);
        ctx.fill();
        ctx.fillStyle = "#f8fafc";
        ctx.font = "700 22px Manrope, sans-serif";
        ctx.fillText(name, cx + padX, cy + padY + 18);
      } else if (draw) {
        ctx.fillStyle = "#cbd5e1";
        ctx.font = "600 22px Manrope, sans-serif";
        ctx.fillText("—", cx, cy + 24);
      }
      cx += cw + chipGap;
      lineH = Math.max(lineH, ch);
    }
    return cy + lineH + 28;
  };

  y = section(
    `Были на сервере, в клане на сайте нет (${p.notInClan.length})`,
    p.notInClan,
    "#fb923c",
    y
  );
  y += 8;
  y = cards(
    [
      { title: "Вчера были, сегодня нет", value: String(row.ydayMissingN), color: "#fbbf24" },
      { title: "За неделю были, вчера нет", value: String(row.weekMissingN), color: "#f87171" },
    ],
    2,
    y
  );
  y += 28;
  y = section(
    `Вчера (${p.yday}) были — сегодня нет (${row.ydayMissingN})`,
    p.ydayMissing,
    "#fbbf24",
    y
  );
  y = section(
    `За неделю были, вчера нет (${row.weekMissingN})`,
    p.weekMissing,
    "#f87171",
    y
  );
  y = section(
    `Резерв или выходной, сегодня нет (${p.excusedAbsent.length})`,
    p.excusedAbsent,
    "#94a3b8",
    y
  );
  y = section(
    `Первый заход после 21:30 — перезаход не считается (${row.lateFirstN})`,
    p.lateFirst,
    "#a78bfa",
    y
  );
  y = section(
    `Кого не было больше недели (${p.absentOverWeek.length})`,
    p.absentOverWeek,
    "#f9a8d4",
    y
  );
  y = section(
    `В клане на сайте, в строках выше их нет (${p.neverSeen.length})`,
    p.neverSeen,
    "#94a3b8",
    y
  );
  return y + 24;
}

export async function downloadBbTrainReportPng(
  row: BbTrainReportRow,
  date: string,
  slot: BbTrainSlot
) {
  await document.fonts.load("700 22px Manrope");
  await document.fonts.load("700 46px Oxanium");
  const when = `${date.split("-").reverse().join(".")} · ${slot === "2130" ? "21:30" : "01:00"}`;
  const measure = document.createElement("canvas").getContext("2d");
  if (!measure) return;
  const height = Math.ceil(paint(measure, row, when, false));
  const scale = 2;
  const canvas = document.createElement("canvas");
  canvas.width = W * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.scale(scale, scale);
  paint(ctx, row, when, true);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/png")
  );
  if (!blob) return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${date}-bb-report-${slot}.png`;
  a.click();
  URL.revokeObjectURL(url);
}
