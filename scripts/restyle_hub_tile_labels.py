"""
Стирает вшитый текст на плитках home-hub и рисует подписи
в стиле «КЛАНОВЫЕ ВОЙНЫ»: жирный caps + золотое свечение.
Идемпотентно: всегда читает оригинал из _label-bak/.
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[1]
HUB = ROOT / "public" / "home-hub"
BACKUP = HUB / "_label-bak"

LABELS: dict[str, str] = {
    "tournaments.png": "ТУРНИРЫ",
    "public-rating.png": "РЕЙТИНГ\nПАБЛИКА",
    "clan-wars.png": "КЛАНОВЫЕ\nВОЙНЫ",
    "training.png": "ТРЕНИРОВКА",
    "battle-pass.png": "BATTLE PASS",
    "marketplace.png": "ТОРГОВАЯ\nПЛОЩАДКА",
    "my-clan.png": "МОЙ КЛАН",
    "my-team.png": "МОЯ\nКОМАНДА",
    "my-faction.png": "МОЯ\nФРАКЦИЯ",
}

FONT_CANDIDATES = [
    Path(r"C:\Windows\Fonts\arialbd.ttf"),
    Path(r"C:\Windows\Fonts\ARIALNB.TTF"),
    Path(r"C:\Windows\Fonts\bahnschrift.ttf"),
    Path(r"C:\Windows\Fonts\impact.ttf"),
]


def pick_font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for p in FONT_CANDIDATES:
        if p.exists():
            try:
                return ImageFont.truetype(str(p), size=size)
            except OSError:
                continue
    return ImageFont.load_default()


def is_text_pixel(r: np.ndarray, g: np.ndarray, b: np.ndarray, a: np.ndarray) -> np.ndarray:
    return (
        (a > 140)
        & (r > 145)
        & (g > 100)
        & (b < 155)
        & ((r.astype(np.int16) + g.astype(np.int16)) > (b.astype(np.int16) * 2))
        & (r.astype(np.int16) > b.astype(np.int16) + 30)
    )


def erase_text(im: Image.Image) -> Image.Image:
    """Точечно затирает золотой текст локальным тёмным фоном (без серой полосы)."""
    arr = np.array(im.convert("RGBA"), dtype=np.uint8)
    h, w = arr.shape[:2]
    y0 = int(h * 0.60)
    band = arr[y0:].copy()
    r = band[:, :, 0].astype(np.int16)
    g = band[:, :, 1].astype(np.int16)
    b = band[:, :, 2].astype(np.int16)
    a = band[:, :, 3]
    mask = is_text_pixel(
        band[:, :, 0], band[:, :, 1], band[:, :, 2], band[:, :, 3]
    )

    mimg = Image.fromarray((mask.astype(np.uint8) * 255), mode="L")
    mimg = mimg.filter(ImageFilter.MaxFilter(7))
    mimg = mimg.filter(ImageFilter.GaussianBlur(1.4))
    mask2 = np.array(mimg) > 28

    # Локальный fill: медиана тёмных пикселей в окне вокруг каждой строки.
    out = band.copy()
    bh, bw = band.shape[:2]
    dark = (a > 160) & (r < 95) & (g < 95) & (b < 120) & (~mask)
    # глобальный fallback
    if dark.any():
        fallback = np.array(
            [
                int(np.median(band[:, :, 0][dark])),
                int(np.median(band[:, :, 1][dark])),
                int(np.median(band[:, :, 2][dark])),
                255,
            ],
            dtype=np.uint8,
        )
    else:
        fallback = np.array([16, 18, 26, 255], dtype=np.uint8)

    ys, xs = np.where(mask2)
    for y, x in zip(ys.tolist(), xs.tolist()):
        y1, y2 = max(0, y - 10), min(bh, y + 11)
        x1, x2 = max(0, x - 18), min(bw, x + 19)
        win = band[y1:y2, x1:x2]
        wr, wg, wb, wa = win[:, :, 0], win[:, :, 1], win[:, :, 2], win[:, :, 3]
        local_dark = (
            (wa > 160)
            & (wr < 100)
            & (wg < 100)
            & (wb < 125)
            & (~is_text_pixel(wr, wg, wb, wa))
        )
        if local_dark.any():
            out[y, x] = [
                int(np.median(wr[local_dark])),
                int(np.median(wg[local_dark])),
                int(np.median(wb[local_dark])),
                255,
            ]
        else:
            out[y, x] = fallback

    arr[y0:] = out
    return Image.fromarray(arr, mode="RGBA")


def fit_font(
    draw: ImageDraw.ImageDraw,
    lines: list[str],
    max_w: int,
    max_h: int,
    gap_ratio: float,
) -> ImageFont.ImageFont:
    size = 42 if len(lines) > 1 else 52
    while size >= 16:
        font = pick_font(size)
        widths = []
        heights = []
        for line in lines:
            box = draw.textbbox((0, 0), line, font=font)
            widths.append(box[2] - box[0])
            heights.append(box[3] - box[1])
        gap = max(8, int(size * gap_ratio))
        stroke = max(1, size // 20)
        total_h = (
            sum(heights)
            + max(0, len(lines) - 1) * (gap + stroke * 2)
            + stroke * 2
        )
        if max(widths) <= max_w and total_h <= max_h:
            return font
        size -= 1
    return pick_font(16)


def draw_gold_label(im: Image.Image, text: str) -> Image.Image:
    w, h = im.size
    lines = [ln.strip() for ln in text.split("\n") if ln.strip()]
    probe = ImageDraw.Draw(im)
    max_w = int(w * 0.66)
    # Двухстрочным — больше высоты блока и межстрочный зазор.
    multiline = len(lines) > 1
    gap_ratio = 0.48 if multiline else 0.12
    max_h = int(h * (0.24 if multiline else 0.16))
    font = fit_font(probe, lines, max_w, max_h, gap_ratio)
    stroke_w = max(1, getattr(font, "size", 28) // 20)

    metrics = []
    for line in lines:
        box = probe.textbbox((0, 0), line, font=font, stroke_width=stroke_w)
        metrics.append((line, box[2] - box[0], box[3] - box[1], -box[1]))
    gap = max(8, int(getattr(font, "size", 28) * gap_ratio))
    step_extra = stroke_w * 2
    block_h = sum(m[2] for m in metrics) + (gap + step_extra) * (
        len(metrics) - 1
    )
    # Чуть ниже, чтобы не наезжать на иконку (шеврон / весы / щит).
    top = int(h * (0.77 if multiline else 0.735)) - block_h // 2
    top = max(int(h * 0.67), min(top, int(h * 0.86) - block_h))

    fill_color = (255, 224, 110, 255)
    stroke_color = (90, 50, 8, 230)

    y = top
    for line, tw, th, ascent in metrics:
        x = (w - tw) // 2
        for rad, alpha in ((6, 30), (3, 55), (1, 80)):
            glow = Image.new("RGBA", im.size, (0, 0, 0, 0))
            gd = ImageDraw.Draw(glow)
            gd.text(
                (x, y + ascent),
                line,
                font=font,
                fill=(255, 200, 70, alpha),
                anchor="lt",
            )
            glow = glow.filter(ImageFilter.GaussianBlur(rad))
            im = Image.alpha_composite(im, glow)
        draw = ImageDraw.Draw(im)
        draw.text(
            (x, y + ascent),
            line,
            font=font,
            fill=fill_color,
            stroke_width=stroke_w,
            stroke_fill=stroke_color,
            anchor="lt",
        )
        y += th + gap + step_extra
    return im


def main() -> None:
    BACKUP.mkdir(parents=True, exist_ok=True)
    for name, label in LABELS.items():
        src = HUB / name
        if not src.exists():
            print("skip missing", name)
            continue
        bak = BACKUP / name
        # Если бэкап уже испорчен прошлым прогоном — не перезаписываем.
        # Первый запуск: копируем текущий файл, если бэкапа нет.
        if not bak.exists():
            bak.write_bytes(src.read_bytes())
        im = Image.open(bak).convert("RGBA")
        im = erase_text(im)
        im = draw_gold_label(im, label)
        im.save(src, optimize=True)
        print("ok", name, "→", label.replace("\n", " / "))


if __name__ == "__main__":
    main()
