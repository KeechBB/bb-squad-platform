#!/usr/bin/env python3
"""Рисует PNG-сводку smoke-тестов для чата Cursor."""
from __future__ import annotations

import json
import sys
from datetime import datetime
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
RESULTS = ROOT / "qa" / "last-results.json"
OUT_DIR = ROOT / "qa" / "previews"
LOGO = (
    ROOT.parent / "brand" / "logos" / "blackberry.png"
)
if not LOGO.is_file():
    LOGO = ROOT / "public" / "blackberry.png"

# Палитра (не purple-AI дефолт)
BG = (18, 22, 28)
CARD = (28, 34, 42)
LINE = (48, 56, 68)
OK = (52, 168, 98)
FAIL = (220, 70, 70)
SKIP = (180, 150, 60)
MUTED = (140, 150, 165)
TEXT = (235, 238, 242)
TITLE = (255, 255, 255)


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    candidates = [
        r"C:\Windows\Fonts\segoeui.ttf",
        r"C:\Windows\Fonts\segoeuib.ttf" if bold else r"C:\Windows\Fonts\segoeui.ttf",
        r"C:\Windows\Fonts\arial.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else None,
    ]
    for path in candidates:
        if path and Path(path).is_file():
            try:
                return ImageFont.truetype(path, size)
            except OSError:
                continue
    return ImageFont.load_default()


def load_suites(path: Path) -> list[dict]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    rows: list[dict] = []

    def walk(suite: dict, prefix: str = "") -> None:
        title = suite.get("title") or ""
        next_prefix = f"{prefix} › {title}" if prefix and title else (title or prefix)
        for spec in suite.get("specs") or []:
            tests = spec.get("tests") or [{}]
            t0 = tests[0]
            results = t0.get("results") or []
            status = (results[-1].get("status") if results else None) or t0.get("status") or "unknown"
            # playwright json: status expected/unexpected/flaky/skipped; result status passed/failed/timedOut/skipped
            if status in ("passed", "expected"):
                mark = "ok"
            elif status in ("skipped",):
                mark = "skip"
            else:
                mark = "fail"
            name = spec.get("title") or "unnamed"
            full = f"{next_prefix}: {name}" if next_prefix else name
            rows.append({"name": full, "mark": mark, "status": status})
        for child in suite.get("suites") or []:
            walk(child, next_prefix)

    for suite in raw.get("suites") or []:
        walk(suite)
    return rows


def main() -> int:
    if not RESULTS.is_file():
        print(f"no results: {RESULTS}", file=sys.stderr)
        return 1

    rows = load_suites(RESULTS)
    if not rows:
        print("empty suites", file=sys.stderr)
        return 1

    raw = json.loads(RESULTS.read_text(encoding="utf-8"))
    base = (raw.get("config") or {}).get("metadata") or {}
    # baseURL лежит в config.projects[0].use — проще из env / файла
    stats = raw.get("stats") or {}
    started = stats.get("startTime")
    when = datetime.now().strftime("%Y-%m-%d %H:%M")
    if started:
        try:
            when = datetime.fromisoformat(started.replace("Z", "+00:00")).astimezone().strftime(
                "%Y-%m-%d %H:%M"
            )
        except ValueError:
            pass

    n_ok = sum(1 for r in rows if r["mark"] == "ok")
    n_fail = sum(1 for r in rows if r["mark"] == "fail")
    n_skip = sum(1 for r in rows if r["mark"] == "skip")
    all_ok = n_fail == 0

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    day = datetime.now().strftime("%Y-%m-%d")
    out = OUT_DIR / f"{day}-smoke.png"

    row_h = 44
    header_h = 120
    footer_h = 48
    width = 920
    height = header_h + 16 + len(rows) * row_h + footer_h

    img = Image.new("RGB", (width, height), BG)
    draw = ImageDraw.Draw(img)

    # logo
    logo_size = 72
    if LOGO.is_file():
        logo = Image.open(LOGO).convert("RGBA")
        logo.thumbnail((logo_size, logo_size), Image.Resampling.LANCZOS)
        img.paste(logo, (28, 24), logo)

    f_title = font(28, bold=True)
    f_sub = font(16)
    f_row = font(17)
    f_badge = font(15, bold=True)

    draw.text((120, 28), "BlackBerry · smoke", fill=TITLE, font=f_title)
    verdict = "ВСЁ ЗЕЛЁНОЕ" if all_ok else "ЕСТЬ ПРОВАЛЫ"
    draw.text(
        (120, 68),
        f"{verdict}  ·  {when}  ·  bb-squad.ru",
        fill=OK if all_ok else FAIL,
        font=f_sub,
    )

    y = header_h
    for r in rows:
        draw.rounded_rectangle((24, y, width - 24, y + row_h - 6), radius=8, fill=CARD)
        if r["mark"] == "ok":
            badge, color = "ОК", OK
        elif r["mark"] == "skip":
            badge, color = "SKIP", SKIP
        else:
            badge, color = "FAIL", FAIL
        draw.rounded_rectangle((36, y + 8, 100, y + row_h - 14), radius=6, fill=color)
        tw = draw.textlength(badge, font=f_badge)
        draw.text((68 - tw / 2, y + 12), badge, fill=(255, 255, 255), font=f_badge)
        label = r["name"]
        if len(label) > 78:
            label = label[:75] + "…"
        draw.text((118, y + 11), label, fill=TEXT, font=f_row)
        y += row_h

    summary = f"ok {n_ok}  ·  fail {n_fail}  ·  skip {n_skip}"
    draw.text((28, height - 36), summary, fill=MUTED, font=f_sub)
    draw.text(
        (width - 28, height - 36),
        "qa/previews",
        fill=LINE,
        font=f_sub,
        anchor="ra",
    )

    img.save(out, "PNG")
    latest = OUT_DIR / "latest-smoke.png"
    img.save(latest, "PNG")
    print(str(out))
    print(str(latest))
    return 0 if all_ok else 2


if __name__ == "__main__":
    raise SystemExit(main())
