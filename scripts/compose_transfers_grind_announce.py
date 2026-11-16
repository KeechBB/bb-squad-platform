#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Анонс: как фракция зарабатывает B$ — канон FACTION-TRANSFERS.md."""
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
PANEL2 = (22, 18, 36)
LINE = (42, 48, 68)
TXT = (241, 245, 249)
MUTED = (148, 163, 184)
PURPLE = (167, 139, 250)
PURPLE_D = (124, 58, 237)
GREEN = (74, 222, 128)
AMBER = (251, 191, 36)
CYAN = (56, 189, 248)
RED = (248, 113, 113)


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(FONT_B if bold else FONT, size)


def rounded(d, box, fill, outline=None, width=1, r=18):
    d.rounded_rectangle(box, radius=r, fill=fill, outline=outline, width=width)


def text_w(d, text, fnt) -> int:
    b = d.textbbox((0, 0), text, font=fnt)
    return b[2] - b[0]


def wrap(d, text, fnt, max_w):
    words = text.split()
    lines, cur = [], ""
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


def section(d, x, y, w, h, title, accent):
    rounded(d, (x, y, x + w, y + h), PANEL, outline=LINE, width=2, r=20)
    d.rectangle((x, y, x + 8, y + h), fill=accent)
    d.text((x + 28, y + 18), title, fill=accent, font=font(28, True))
    return y + 58


def bullets(d, x, y, items, max_w):
    for text, color in items:
        fnt = font(22)
        for i, ln in enumerate(wrap(d, text, fnt, max_w - 28)):
            d.text((x, y), ("•  " if i == 0 else "   ") + ln, fill=color, font=fnt)
            y += 30
        y += 6
    return y


def rate_card(d, x, y, w, h, title, rate, accent, hint):
    rounded(d, (x, y, x + w, y + h), PANEL2, outline=accent, width=2, r=16)
    d.text((x + 22, y + 18), title, fill=MUTED, font=font(20, True))
    d.text((x + 22, y + 52), rate, fill=accent, font=font(36, True))
    d.text((x + 22, y + 100), hint, fill=TXT, font=font(18))


def main():
    W, H = 1600, 1880
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)

    for i in range(6):
        d.ellipse((1050 + i * 30, 60 + i * 220, 1850, 520 + i * 220), fill=(20, 28, 22))

    logo = Image.open(LOGO).convert("RGBA")
    logo.thumbnail((140, 140), Image.Resampling.LANCZOS)
    img.paste(logo, (48, 36), logo)

    d.text((210, 48), "BLACKBERRY", fill=PURPLE, font=font(24, True))
    d.text((210, 80), "КАК ЗАРАБАТЫВАТЬ B$", fill=TXT, font=font(46, True))
    d.text(
        (210, 140),
        "Канон · с Fool's Road 16.11.2026 21:33 · потолка нет",
        fill=MUTED,
        font=font(22),
    )
    d.text((210, 174), datetime.now().strftime("%d.%m.%Y"), fill=CYAN, font=font(20, True))

    rounded(d, (48, 220, W - 48, 380), (16, 28, 22), outline=GREEN, width=2, r=18)
    d.text((72, 240), "Коротко", fill=GREEN, font=font(22, True))
    d.text(
        (72, 276),
        "TR1–TR5 → залитая тренировка → каждое действие капает B$ в казну фракции.\n"
        "Старт: Fool's Road AAS 16.11 · 21:33. Всё раньше — не считается.\n"
        "50 киллов = 50 × тариф. Потолка за катку нет.",
        fill=TXT,
        font=font(24),
    )

    y = 410
    h = 280
    section(d, 48, y, W - 96, h, "1. Что платит в казну (линейно)", GREEN)
    gap = 18
    card_w = (W - 96 - gap * 3) // 4
    card_h = 140
    cx, cy = 76, y + 70
    rate_card(d, cx, cy, card_w, card_h, "Убийство", "+85 B$", CYAN, "за каждый килл")
    cx += card_w + gap
    rate_card(d, cx, cy, card_w, card_h, "Рес", "+110 B$", GREEN, "за каждый рес")
    cx += card_w + gap
    rate_card(d, cx, cy, card_w, card_h, "Урон по технике", "+0,12 B$", AMBER, "за 1 ед. урона")
    cx += card_w + gap
    rate_card(d, cx, cy, card_w, card_h, "Уничтожение техники", "+450 B$", PURPLE, "за каждую технику")

    y += h + 22
    h = 250
    section(d, 48, y, W - 96, h, "2. Формула и оценка на рынке", CYAN)
    rounded(d, (76, y + 58, W - 76, y + 150), PANEL2, outline=PURPLE_D, width=2, r=14)
    d.text(
        (96, y + 78),
        "B$ = киллы·85 + ресы·110 + урон·0,12 + уничтожения·450",
        fill=TXT,
        font=font(24, True),
    )
    d.text(
        (96, y + 114),
        "Рыночная оценка игрока = старая формула + round(его гринд в казну / 1000)·1000",
        fill=MUTED,
        font=font(20),
    )
    bullets(
        d,
        76,
        y + 168,
        [
            ("Гринд копится в казне и одновременно поднимает цену игрока на доске.", GREEN),
            ("Только залитый TRAIN TR1–TR5. Паблик / FCL / КВ / сырой лог — нет.", RED),
        ],
        W - 160,
    )

    y += h + 22
    h = 280
    section(d, 48, y, W - 96, h, "3. Откуда берётся матч", AMBER)
    bullets(
        d,
        76,
        y + 58,
        [
            ("Серверы TR1–TR5, kind=TRAIN, уже в статистике тренировок.", TXT),
            ("Старт: Fool's Road 16.11.2026 21:33 МСК — предыдущие катки не капают.", AMBER),
            ("Повторно за ту же катку не капает (один sourceKey на игрока).", MUTED),
            ("Деньги → казна фракции, не личный BBC.", PURPLE),
            ("Нет матча в статистике → нет B$, даже если люди были на сервере.", RED),
        ],
        W - 160,
    )

    y += h + 22
    col_w = (W - 48 * 2 - 24) // 2
    h = 240
    section(d, 48, y, col_w, h, "4. Зачем штабу", AMBER)
    bullets(
        d,
        76,
        y + 58,
        [
            ("Казна = топливо BUY / SWAP+.", TXT),
            ("Активные на TR фракции богаче на рынке.", TXT),
            ("Трансферы → Движение казны.", MUTED),
        ],
        col_w - 56,
    )
    section(d, 48 + col_w + 24, y, col_w, h, "5. Канон", PURPLE)
    bullets(
        d,
        48 + col_w + 24 + 28,
        y + 58,
        [
            ("docs/FACTION-TRANSFERS.md", TXT),
            ("blueberryDollar.ts · factionTransfers.ts", MUTED),
            ("Ники в UI — жёлтым.", AMBER),
        ],
        col_w - 56,
    )

    y += h + 28
    rounded(d, (48, y, W - 48, y + 120), (16, 22, 30), outline=GREEN, width=2, r=16)
    d.text((72, y + 24), "Итог для командиров", fill=GREEN, font=font(24, True))
    d.text(
        (72, y + 62),
        "Ходите на TR с Fool's Road → убивайте / ресьте / бейте технику → заливайте статистику.\n"
        "Каждое действие = деньги в казну + вклад в рыночную цену игрока.",
        fill=TXT,
        font=font(22),
    )

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out = OUT_DIR / f"{datetime.now().strftime('%Y-%m-%d')}-transfers-grind-announce.png"
    img.save(out, "PNG", optimize=True)
    print(out)
    return out


if __name__ == "__main__":
    main()
