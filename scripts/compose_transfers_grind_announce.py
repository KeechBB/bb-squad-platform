#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Отдельный анонс: как фракция зарабатывает Черничные Доллары."""
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


def main():
    W, H = 1600, 1750
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
        "Черничный Доллар → казна фракции  ·  только из залитых тренировок",
        fill=MUTED,
        font=font(22),
    )
    d.text((210, 174), datetime.now().strftime("%d.%m.%Y"), fill=CYAN, font=font(20, True))

    # hero strip
    rounded(d, (48, 220, W - 48, 360), (16, 28, 22), outline=GREEN, width=2, r=18)
    d.text((72, 240), "Коротко", fill=GREEN, font=font(22, True))
    d.text(
        (72, 276),
        "Игроки ходят на TR1–TR5 → матч заливается в статистику тренировок →\n"
        "система капает B$ в казну фракции каждого участника. Паблик / FCL / сырой лог — нет.",
        fill=TXT,
        font=font(24),
    )

    y = 390
    h = 340
    section(d, 48, y, W - 96, h, "1. Что считается источником гринда", GREEN)
    bullets(
        d,
        76,
        y + 58,
        [
            ("Только серверы TR1, TR2, TR3, TR4, TR5.", TXT),
            ("Только матчи kind=TRAIN, уже залитые в статистику тренировок (есть в профиле / календаре).", TXT),
            ("Не считается: паблик (PB1), FCL/srv, клановые войны, незалитый коллектор.", RED),
            ("Повторно за ту же катку не капает — начисление идемпотентное.", MUTED),
            ("Деньги идут в казну фракции игрока, не на личный баланс BBC.", PURPLE),
        ],
        W - 160,
    )

    y += h + 22
    h = 300
    section(d, 48, y, W - 96, h, "2. Формула за одну залитую катку", CYAN)
    rounded(d, (76, y + 58, W - 76, y + 150), PANEL2, outline=PURPLE_D, width=2, r=14)
    d.text(
        (96, y + 78),
        "B$ ≈ clamp( (k·2.2 + nok·1.4 + res·1.1 − d·0.35) · 18 · time + 120 ,  0 … 2500 )",
        fill=TXT,
        font=font(22, True),
    )
    d.text(
        (96, y + 112),
        "k / d / nok / res — стата игрока в матче; time = длительность/час (0.55…1.35)",
        fill=MUTED,
        font=font(18),
    )
    bullets(
        d,
        76,
        y + 168,
        [
            ("Обычная катка даёт примерно 200–2200 B$ на человека в казну.", TXT),
            ("Потолок за одну катку на игрока: 2500 B$.", AMBER),
            ("Чем выше вклад (киллы / ноки / ресы) и длиннее матч — тем больше капля.", TXT),
        ],
        W - 160,
    )

    y += h + 22
    col_w = (W - 48 * 2 - 24) // 2
    h = 320
    section(d, 48, y, col_w, h, "3. Зачем это штабу", AMBER)
    bullets(
        d,
        76,
        y + 58,
        [
            ("Казна = топливо для BUY и доплат в SWAP+.", TXT),
            ("Без гринда сделок почти не будет — только если уже есть запас.", TXT),
            ("Чем активнее фракция на TR, тем богаче штаб на рынке.", TXT),
            ("Смотреть: Трансферы → Движение казны.", MUTED),
        ],
        col_w - 56,
    )
    section(d, 48 + col_w + 24, y, col_w, h, "4. Как проверить", PURPLE)
    bullets(
        d,
        48 + col_w + 24 + 28,
        y + 58,
        [
            ("Матч есть во вкладке тренировок / в профиле игрока.", TXT),
            ("После залива при открытии Трансферов казна может подрасти.", TXT),
            ("В «Движение казны» тип проводки: Гринд TR.", TXT),
            ("Если матч не в статистике — B$ не будет, даже если люди были на сервере.", RED),
        ],
        col_w - 56,
    )

    y += h + 28
    rounded(d, (48, y, W - 48, y + 120), (16, 22, 30), outline=GREEN, width=2, r=16)
    d.text((72, y + 24), "Итог для командиров", fill=GREEN, font=font(24, True))
    d.text(
        (72, y + 62),
        "Ходите на TR1–TR5 → заливайте статистику → копите казну → торгуйте на доске.\n"
        "B$ = награда за реальные тренировки, которые уже записаны на сайте.",
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
