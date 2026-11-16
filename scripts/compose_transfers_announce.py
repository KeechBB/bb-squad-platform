#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Анонс-карточка трансферной системы для командиров / замов."""
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
PINK = (244, 114, 182)


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


def draw_section(d, x, y, w, h, title: str, accent):
    rounded(d, (x, y, x + w, y + h), PANEL, outline=LINE, width=2, r=20)
    d.rectangle((x, y, x + 8, y + h), fill=accent)
    d.text((x + 28, y + 18), title, fill=accent, font=font(28, True))
    return y + 58


def bullet(d, x, y, lines: list[tuple[str, tuple]], max_w: int) -> int:
    for text, color in lines:
        fnt = font(22)
        for i, ln in enumerate(wrap(d, text, fnt, max_w - 28)):
            prefix = "•  " if i == 0 else "   "
            d.text((x, y), prefix + ln, fill=color, font=fnt)
            y += 30
        y += 4
    return y


def formula_box(d, x, y, w, title: str, body_lines: list[str], note: str) -> int:
    h = 46 + len(body_lines) * 28 + (34 if note else 12)
    rounded(d, (x, y, x + w, y + h), PANEL2, outline=PURPLE_D, width=2, r=16)
    d.text((x + 18, y + 12), title, fill=PURPLE, font=font(20, True))
    yy = y + 42
    for ln in body_lines:
        d.text((x + 18, yy), ln, fill=TXT, font=font(20, True))
        yy += 28
    if note:
        for ln in wrap(d, note, font(18), w - 36):
            d.text((x + 18, yy), ln, fill=MUTED, font=font(18))
            yy += 24
    return y + h + 14


def main() -> Path:
    W, H = 1600, 2550
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)

    # atmosphere
    for i in range(8):
        alpha_y = 80 + i * 280
        d.ellipse((1100 + i * 20, alpha_y, 1900, alpha_y + 420), fill=(28, 18, 48))

    # header
    logo = Image.open(LOGO).convert("RGBA")
    logo.thumbnail((150, 150), Image.Resampling.LANCZOS)
    img.paste(logo, (48, 36), logo)

    d.text((220, 48), "BLACKBERRY", fill=PURPLE, font=font(26, True))
    d.text((220, 82), "ТРАНСФЕРЫ ФРАКЦИЙ", fill=TXT, font=font(48, True))
    d.text(
        (220, 142),
        "Анонс для командиров и замов  ·  как устроена система  ·  формулы и тонкости",
        fill=MUTED,
        font=font(22),
    )
    day = datetime.now().strftime("%d.%m.%Y")
    d.text((220, 176), f"Старт теста  ·  {day}", fill=CYAN, font=font(20, True))

    # currency strip
    rounded(d, (48, 230, W - 48, 330), (24, 16, 42), outline=PURPLE, width=2, r=18)
    d.text((72, 248), "Валюта", fill=MUTED, font=font(18))
    d.text((72, 274), "Черничный Доллар  ·  B$", fill=PURPLE, font=font(34, True))
    d.text(
        (620, 262),
        "Казна фракции. Не BBC и не монеты маркета.\nГринд → казна → сделки на доске.",
        fill=TXT,
        font=font(22),
    )

    y = 356
    col_w = (W - 48 * 2 - 24) // 2
    left_x = 48
    right_x = 48 + col_w + 24

    # LEFT: access + flow
    left_h = 520
    draw_section(d, left_x, y, col_w, left_h, "1. Доступ и роли", GREEN)
    bullet(
        d,
        left_x + 28,
        y + 58,
        [
            ("Участвует фракция с составом ≥ 30 человек.", TXT),
            ("Окно трансферов открывает / закрывает Keech (даты).", TXT),
            ("Командир / зам: выставление, оферы, принятие сделок, доска, баланс ролей.", TXT),
            ("Рядовой: видит казну (движение) и рынок оферов/лотов. Штабные кнопки скрыты.", MUTED),
            ("После сделки — фиолетовые письма участникам и штабам.", TXT),
            ("Лок игрока после сделки: 14 суток (снова на доску нельзя).", AMBER),
        ],
        col_w - 56,
    )

    # RIGHT: deal types
    draw_section(d, right_x, y, col_w, left_h, "2. Три формата сделки", CYAN)
    bullet(
        d,
        right_x + 28,
        y + 58,
        [
            ("BUY — покупка за B$ из казны покупателя.", TXT),
            ("SWAP — обмен игроками без денег.", TXT),
            ("SWAP + доплата — игрок + B$ сверху.", TXT),
            ("Поток: лот на доске → офер покупателя → штаб продавца принимает / отклоняет.", TXT),
            ("Деньги списываются / зачисляются в казны только при подтверждении.", TXT),
            ("Рынок «Сейчас открыты» видят все: лоты + оферы всех фракций.", PURPLE),
        ],
        col_w - 56,
    )

    y += left_h + 24

    # listing rules full width
    h = 250
    draw_section(d, 48, y, W - 96, h, "3. Выставление на доску", AMBER)
    bullet(
        d,
        76,
        y + 58,
        [
            ("Минимум цены: 5 000 B$. Нельзя ниже 80% оценочной стоимости игрока.", TXT),
            ("Оценка — ориентир (не жёсткая цена сделки). Командир ставит свою, но не демпингует ниже пола.", TXT),
            ("Глава фракции (LEADER) на доску не выставляется.", MUTED),
            ("Дефицит ролей подсвечивается при покупке; при продаже редкого кита — предупреждение штабу.", TXT),
        ],
        W - 160,
    )
    y += h + 20

    # formulas
    h = 430
    draw_section(d, 48, y, W - 96, h, "4. Формулы", PURPLE)
    fy = y + 58
    fy = formula_box(
        d,
        76,
        fy,
        W - 152,
        "Оценочная стоимость игрока (округление до 500, пол 15k, потолка нет)",
        [
            "цена ≈ (22 000 + явка14/14×40 000 + вклад_боя_30д) × KD × роль × дефицит × свежесть",
        ],
        "Явка = уникальные дни TR1–TR5 за 14 суток. Бой = киллы·95 + ресы·120 + ноки·55 + матчи·320 (внутр. вклад до 85k). "
        "KD-множитель ~0.75–1.65. Роль: SL×1.55, медик×1.42, AT/LAT×1.35, AR/MG×1.2, rifle×1.0. "
        "Дефицит: critical×1.45 / thin×1.22 / surplus×0.88. Свежесть по lastSeen на сайте.",
    )
    fy = formula_box(
        d,
        76,
        fy,
        W - 152,
        "Гринд в казну за залитую тренировку TR1–TR5 (не FCL / не паблик / не сырой лог)",
        [
            "B$ ≈ clamp( (k·2.2 + nok·1.4 + res·1.1 − d·0.35) · 18 · time + 120 , 0…2500 )",
        ],
        "time = длительность/3600 (0.55…1.35). Начисление только если матч уже в статистике тренировок "
        "(опубликованный legacyId в профиле). Идемпотентно: повторно за ту же катку не капает.",
    )
    y += h + 20

    # bottom two cols
    bot_h = 380
    draw_section(d, left_x, y, col_w, bot_h, "5. Где смотреть на сайте", CYAN)
    bullet(
        d,
        left_x + 28,
        y + 58,
        [
            ("Страница фракции → вкладка «Трансферы».", TXT),
            ("Штаб: подвкладки Выставление / Движение казны / Оферы и сделки.", TXT),
            ("Рядовые: Казна + Оферы (весь рынок).", TXT),
            ("Модалки офера / аналитики таскаются и поверх всего UI.", MUTED),
            ("Письма о сделках — фиолетовые, в ЛК.", PURPLE),
        ],
        col_w - 56,
    )

    draw_section(d, right_x, y, col_w, bot_h, "6. Зачем это вообще", PINK)
    bullet(
        d,
        right_x + 28,
        y + 58,
        [
            ("Баланс ролей между фракциями без хаоса «увел игрока в личке».", TXT),
            ("Казна растёт от реальных TR, которые идут в статистику.", TXT),
            ("Цена отражает явку, вклад и редкость роли — не фантазию.", TXT),
            ("Все видят рынок: лоты и оферы прозрачны.", TXT),
            ("Штаб решает, игрок получает письмо и 14 дней лока.", MUTED),
        ],
        col_w - 56,
    )

    y += bot_h + 28
    rounded(d, (48, y, W - 48, y + 110), (16, 20, 30), outline=GREEN, width=2, r=16)
    d.text((72, y + 22), "Коротко для штаба", fill=GREEN, font=font(24, True))
    d.text(
        (72, y + 58),
        "Открыто окно + ≥30 в составе → выставь лот (≥80% оценки) → жди офер → прими/отклони. "
        "Казна = гринд с залитых TR1–TR5. Рынок видят все.",
        fill=TXT,
        font=font(22),
    )

    footer_y = y + 130
    d.text(
        (48, footer_y),
        "BlackBerry  ·  трансферная система фракций  ·  B$  ·  только для командного состава и теста",
        fill=MUTED,
        font=font(18),
    )

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out = OUT_DIR / f"{datetime.now().strftime('%Y-%m-%d')}-transfers-announce.png"
    # crop if too much empty — keep fixed canvas
    img.save(out, "PNG", optimize=True)
    print(out)
    return out


if __name__ == "__main__":
    main()
