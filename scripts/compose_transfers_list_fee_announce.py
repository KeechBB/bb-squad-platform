#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Анонс: комиссия 1% за создание трансферного лота."""
from __future__ import annotations

from datetime import datetime
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(r"D:\BlackBerry\Новый Проект Кича")
LOGO = ROOT / "brand" / "logos" / "blackberry.png"
OUT_DIR = ROOT / "KV" / "previews"
FONT = r"C:\Windows\Fonts\segoeui.ttf"
FONT_B = r"C:\Windows\Fonts\seguisb.ttf"

BG = (10, 12, 18)
PANEL = (18, 22, 34)
LINE = (42, 48, 68)
TXT = (241, 245, 249)
MUTED = (148, 163, 184)
PURPLE = (167, 139, 250)
PURPLE_D = (124, 58, 237)
AMBER = (251, 191, 36)
CYAN = (56, 189, 248)
GREEN = (74, 222, 128)
RED = (248, 113, 113)


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(FONT_B if bold else FONT, size)


def rounded(d: ImageDraw.ImageDraw, box, fill, outline=None, width=1, r=18):
    d.rounded_rectangle(box, radius=r, fill=fill, outline=outline, width=width)


def text_w(d: ImageDraw.ImageDraw, text: str, fnt) -> int:
    b = d.textbbox((0, 0), text, font=fnt)
    return b[2] - b[0]


def wrap(d: ImageDraw.ImageDraw, text: str, fnt, max_w: int) -> list[str]:
    words = text.split()
    lines: list[str] = []
    cur = ""
    for w in words:
        trial = f"{cur} {w}".strip()
        if text_w(d, trial, fnt) <= max_w:
            cur = trial
        else:
            if cur:
                lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines or [""]


def main() -> Path:
    W, H = 1400, 900
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)

    d.ellipse((900, -80, 1600, 420), fill=(28, 18, 48))
    d.ellipse((-120, 520, 420, 980), fill=(16, 28, 40))

    logo = Image.open(LOGO).convert("RGBA")
    logo.thumbnail((120, 120), Image.Resampling.LANCZOS)
    img.paste(logo, (48, 40), logo)

    d.text((190, 48), "BLACKBERRY", fill=PURPLE, font=font(24, True))
    d.text((190, 82), "ТРАНСФЕРЫ · КОМИССИЯ 1%", fill=TXT, font=font(42, True))
    day = datetime.now().strftime("%d.%m.%Y")
    d.text((190, 138), f"Обновление правил доски  ·  {day}", fill=CYAN, font=font(20, True))

    rounded(d, (48, 200, W - 48, 820), PANEL, outline=LINE, width=2, r=24)
    d.rectangle((48, 200, 56, 820), fill=PURPLE_D)

    y = 230
    d.text((80, y), "Что изменилось", fill=AMBER, font=font(28, True))
    y += 52

    bullets = [
        (GREEN, "При создании лота с казны фракции списывается 1% от цены выставления."),
        (AMBER, "Комиссия — плата за удержание игрока на аукционе."),
        (RED, "Если лот снимут без сделки — 1% не возвращается."),
        (CYAN, "Командир и зам платят так же: создание лота = комиссия сразу."),
        (MUTED, "Все текущие лоты сброшены — выставляйте заново уже с новым правилом."),
    ]
    for color, text in bullets:
        for i, ln in enumerate(wrap(d, text, font(24), W - 180)):
            prefix = "▸  " if i == 0 else "   "
            d.text((80, y), prefix + ln, fill=color if i == 0 else TXT, font=font(24))
            y += 36
        y += 10

    y += 12
    rounded(d, (80, y, W - 80, y + 110), (22, 18, 36), outline=PURPLE_D, width=2, r=16)
    d.text((104, y + 22), "Пример", fill=PURPLE, font=font(22, True))
    d.text(
        (104, y + 56),
        "Лот 50 000 B$  →  комиссия 500 B$ с казны сразу при «На доску».",
        fill=TXT,
        font=font(24, True),
    )

    d.text(
        (80, 840),
        "Страница фракции → Трансферы → Выставление",
        fill=MUTED,
        font=font(20),
    )

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out = OUT_DIR / f"{datetime.now().strftime('%Y-%m-%d')}-transfers-list-fee-announce.png"
    img.save(out, "PNG", optimize=True)
    print(out)
    return out


if __name__ == "__main__":
    main()
