#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Before the new site opens: training history still has personal columns,
and plaza has every played match that the disk copy has since 2026-10-20.

Prints counts only. Does not print connection strings.
Exit 0 pass, 1 fail.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import canon_match_write as CANON

ROOT = Path(__file__).resolve().parents[1]
SINCE = "2026-10-20"
OPEN = {"upcoming", "cancel", "cancelled", "canceled"}
HEADER = re.compile(
    r"Результат.{0,180}Ресы.{0,180}Ноки.{0,120}Килы.{0,120}Смерти",
    re.S,
)


def fail(msg: str) -> None:
    print(f"gate FAIL: {msg}", file=sys.stderr)
    raise SystemExit(1)


def warn(msg: str) -> None:
    print(f"gate WARN: {msg}", file=sys.stderr)


def check_columns() -> None:
    root = ROOT / ".next"
    if not root.is_dir():
        fail("no .next build to check")
    hits = 0
    scanned = 0
    for p in root.rglob("*.js"):
        try:
            if p.stat().st_size > 6_000_000:
                continue
            text = p.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        if "Ресы" not in text and "training-match-hist-table" not in text:
            continue
        scanned += 1
        hits += len(HEADER.findall(text))
    print(f"gate columns: personal headers={hits} files={scanned}")
    if hits < 2:
        fail("training history is missing Ресы / Ноки / Килы / Смерти")


def env_value(name: str) -> str:
    path = ROOT / ".env"
    if not path.is_file():
        return ""
    for line in path.read_text(encoding="utf-8").splitlines():
        raw = line.strip()
        if not raw or raw.startswith("#") or "=" not in raw:
            continue
        key, val = raw.split("=", 1)
        if key.strip() != name:
            continue
        return val.strip().strip('"').strip("'")
    return ""


def ymd(year: int, month: int, day: int) -> str:
    if not year or not month or not day:
        return ""
    return f"{year:04d}-{month:02d}-{day:02d}"


def disk_keys(kind: str) -> set[str]:
    data = ROOT / "data" / "kv-cache" / "data"
    keys: set[str] = set()
    if kind == "TRAIN":
        folder = data / "training"
        files = sorted(folder.glob("????-??.json")) if folder.is_dir() else []
    else:
        files = sorted(data.glob("????-??.json")) if data.is_dir() else []
    for path in files:
        m = re.fullmatch(r"(\d{4})-(\d{2})\.json", path.name)
        if not m:
            continue
        year, month = int(m.group(1)), int(m.group(2))
        try:
            doc = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            fail(f"unreadable disk month {path.name}")
        for row in doc.get("matches") or []:
            if not isinstance(row, dict):
                continue
            st = str(row.get("status") or "done").strip().lower()
            if st in OPEN:
                continue
            day = int(row.get("day") or 0)
            stamp = ymd(year, month, day)
            if not stamp or stamp < SINCE:
                continue
            srv = row.get("serverKey") or row.get("server")
            keys.add(
                CANON.make_match_key(
                    year,
                    month,
                    day,
                    str(srv) if srv else None,
                    str(row.get("map") or ""),
                    row.get("timeMsk") or row.get("time"),
                    str(row.get("id") or "") or None,
                    kind,
                )
            )
    return keys


def canon_keys(kind: str) -> set[str]:
    url = env_value("DATABASE_URL")
    if not url:
        fail("DATABASE_URL missing")
    try:
        import psycopg2
    except ImportError:
        fail("psycopg2 missing")
    try:
        conn = psycopg2.connect(url)
    except Exception:
        fail("database unread")
    try:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT "matchKey", year, month, day, status
            FROM "CanonMatch"
            WHERE kind = %s AND "matchKey" IS NOT NULL
            """,
            (kind,),
        )
        keys: set[str] = set()
        for key, year, month, day, status in cur.fetchall():
            st = str(status or "done").strip().lower()
            if st in OPEN:
                continue
            stamp = ymd(int(year or 0), int(month or 0), int(day or 0))
            if key and stamp >= SINCE:
                keys.add(str(key))
        return keys
    finally:
        conn.close()


def signature(key: str) -> str:
    """Server, map and clock. The date is kept in the full key, but one
    match that crosses midnight is stored once in plaza and can appear
    on disk under both the evening date and the clock date.
    """
    date, _, rest = key.partition("_")
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", date) and rest:
        return rest
    return key


def check_kind(kind: str) -> None:
    disk = disk_keys(kind)
    canon = canon_keys(kind)
    canon_sig = {signature(k) for k in canon}
    missing = sorted(k for k in disk if signature(k) not in canon_sig)
    print(
        f"gate {kind}: disk={len(disk)} canon={len(canon)} missing={len(missing)}"
    )
    if missing:
        preview = ", ".join(missing[:8])
        # A match that is on disk but not in plaza yet must not roll the whole
        # site back to the previous build. Columns and unreadable data still fail.
        warn(f"{kind} disk matches absent from plaza: {preview}")


def main() -> int:
    counts_only = "--counts" in sys.argv
    if not counts_only:
        check_columns()
    check_kind("TRAIN")
    check_kind("CW")
    print("gate OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
