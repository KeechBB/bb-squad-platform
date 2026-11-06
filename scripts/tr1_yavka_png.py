#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Big readable TR1 tonight cards (local PNG from JSON or live VPS refresh)."""
from __future__ import annotations

import json
import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(r"D:\BlackBerry\Новый Проект Кича")
JSON_PATH = ROOT / "platform" / "scripts" / "_tmp_tr1_tonight_report.json"
from datetime import datetime

_FALLBACK_DAY = datetime.now().strftime("%Y-%m-%d")

FONT = r"C:\Windows\Fonts\segoeui.ttf"
FONT_B = r"C:\Windows\Fonts\seguisb.ttf"
BG = "#0c0e14"
CARD = "#161a24"
LINE = "#2a3142"
TXT = "#f1f5f9"
MUTED = "#94a3b8"
PURPLE = "#a78bfa"
GREEN = "#4ade80"
AMBER = "#fbbf24"
RED = "#f87171"
CYAN = "#38bdf8"
TIER_C = {1: "#4ade80", 2: "#86efac", 3: "#fde68a", 4: "#fb7185"}


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(FONT_B if bold else FONT, size)


def wrap_chips(draw, names, x, y, max_w, fnt, fill, chip_bg, gap=10, pad_x=14, pad_y=8):
    """Draw name chips; return new y."""
    cx, cy = x, y
    line_h = 0
    for name in names:
        bbox = draw.textbbox((0, 0), name, font=fnt)
        tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
        cw, ch = tw + pad_x * 2, th + pad_y * 2
        if cx + cw > x + max_w and cx > x:
            cx = x
            cy += line_h + gap
            line_h = 0
        draw.rounded_rectangle((cx, cy, cx + cw, cy + ch), radius=10, fill=chip_bg)
        draw.text((cx + pad_x, cy + pad_y - 2), name, fill=fill, font=fnt)
        cx += cw + gap
        line_h = max(line_h, ch)
    return cy + line_h + 8


def card(draw, x, y, w, h, title, value, accent):
    draw.rounded_rectangle((x, y, x + w, y + h), radius=18, fill=CARD, outline=accent, width=3)
    draw.text((x + 22, y + 18), title, fill=MUTED, font=font(22))
    draw.text((x + 22, y + 58), value, fill=accent, font=font(44, True))


def page1(data: dict) -> Image.Image:
    W = 1600
    # estimate height
    H = 2400
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    y = 40
    evening = data.get("roster_mode") == "evening"
    title = "TR1 · вечерняя явка" if evening else "TR1 · кто сейчас онлайн"
    d.text((48, y), title, fill=TXT, font=font(48, True))
    y += 70
    sub = (
        f"Итог вечера {data.get('train_day', '')}   ·   кто был на TR1   ·   BB тиры 1–4: {data['online_bb']}"
        if evening
        else f"{data['now']} МСК   ·   всего на сервере {data['online_total']}"
    )
    d.text((48, y), sub, fill=PURPLE, font=font(28))
    y += 56

    # 4 big tier cards
    counts = {t: len(data["online_names_by_tier"].get(str(t), [])) for t in (1, 2, 3, 4)}
    cw = 360
    gap = 24
    x0 = 48
    for i, t in enumerate((1, 2, 3, 4)):
        card(d, x0 + i * (cw + gap), y, cw, 130, f"ТИР {t}", str(counts[t]), TIER_C[t])
    y += 160

    d.text((48, y), f"Итого тир 1–4: {sum(counts.values())}", fill=TXT, font=font(32, True))
    y += 50

    for t in (1, 2, 3, 4):
        names = data["online_names_by_tier"].get(str(t), [])
        d.text((48, y), f"Тир {t}  ·  {len(names)}", fill=TIER_C[t], font=font(34, True))
        y += 48
        if not names:
            d.text((48, y), "— никого", fill=MUTED, font=font(26))
            y += 40
            continue
        y = wrap_chips(
            d,
            names,
            48,
            y,
            W - 96,
            font(26, True),
            TXT,
            "#1f2433",
            gap=12,
            pad_x=16,
            pad_y=10,
        )
        y += 28

    # crop to content
    H2 = min(H, y + 60)
    return img.crop((0, 0, W, H2))


def page2(data: dict) -> Image.Image:
    W = 1600
    H = 4600
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    y = 40
    d.text((48, y), "TR1 · кого нет + график", fill=TXT, font=font(48, True))
    y += 70
    evening = data.get("roster_mode") == "evening"
    sub = (
        f"Итог вечера {data.get('train_day', '')}   ·   не срез 21:48"
        if evening
        else f"{data['now']} МСК"
    )
    d.text((48, y), sub, fill=PURPLE, font=font(28))
    y += 56

    # summary cards 2x2
    items = [
        ("Вчера были,\nсегодня нет", str(data["yday_missing_n"]), AMBER),
        ("Неделю были,\nсегодня нет", str(data["week_missing_n"]), RED),
        ("График: ждали", str(data["sched_expected"]), CYAN),
        ("График: пришли", str(data["sched_present"]), GREEN),
    ]
    for i, (title, val, col) in enumerate(items):
        col_i, row_i = i % 2, i // 2
        card(d, 48 + col_i * 760, y + row_i * 150, 720, 130, title.replace("\n", " "), val, col)
    y += 330

    def block(title, names, accent, limit=40):
        nonlocal y
        d.text((48, y), f"{title}  ({len(names)})", fill=accent, font=font(32, True))
        y += 46
        show = names[:limit]
        y = wrap_chips(d, show, 48, y, W - 96, font(24, True), TXT, "#1f2433", gap=10, pad_x=14, pad_y=9)
        if len(names) > limit:
            d.text((48, y + 8), f"… ещё {len(names) - limit}", fill=MUTED, font=font(24))
            y += 40
        y += 36

    block(f"Вчера ({data['yday']}) были — сегодня нет", data.get("yday_missing") or [], AMBER, 45)
    block(
        f"За неделю ({data['week_from']}→) были — сегодня нет",
        data.get("week_missing") or [],
        RED,
        50,
    )
    block("График: ждали сегодня, не пришли", data.get("sched_missing") or [], CYAN, 40)
    block("График: пришли из ожидаемых", data.get("sched_present_names") or [], GREEN, 30)
    late = data.get("late_first_after") or []
    block(
        f"Первый заход после {data.get('late_cutoff', '21:30')} — перезаход не считается",
        late,
        PURPLE,
        80,
    )

    d.text(
        (48, y + 10),
        "Источники: TR1 live-лог · SquadServerSession · tiers.json · BB-schedule-visits.xlsx",
        fill=MUTED,
        font=font(20),
    )
    y += 60
    return img.crop((0, 0, W, min(H, y + 40)))


def main():
    data = json.loads(JSON_PATH.read_text(encoding="utf-8"))
    day = data.get("train_day") or _FALLBACK_DAY
    out1 = ROOT / "KV" / "previews" / f"{day}-tr1-yavka-1-online.png"
    out2 = ROOT / "KV" / "previews" / f"{day}-tr1-yavka-2-gaps.png"
    p1 = page1(data)
    p2 = page2(data)
    out1.parent.mkdir(parents=True, exist_ok=True)
    p1.save(out1, "PNG", optimize=True)
    p2.save(out2, "PNG", optimize=True)
    print("wrote", out1, p1.size)
    print("wrote", out2, p2.size)


if __name__ == "__main__":
    main()
