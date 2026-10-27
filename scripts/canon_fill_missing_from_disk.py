#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Copy played matches that exist on disk and are absent from plaza.

Existing canon rows are left alone. Disk is not rewritten.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import canon_match_write as CANON

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data" / "kv-cache" / "data"
SINCE = "2026-10-20"
OPEN = {"upcoming", "cancel", "cancelled", "canceled"}


def ymd(year: int, month: int, day: int) -> str:
    if not year or not month or not day:
        return ""
    return f"{year:04d}-{month:02d}-{day:02d}"


def played(doc: dict, year: int, month: int) -> list[dict]:
    out = []
    for row in doc.get("matches") or []:
        if not isinstance(row, dict):
            continue
        st = str(row.get("status") or "done").strip().lower()
        if st in OPEN:
            continue
        day = int(row.get("day") or 0)
        stamp = ymd(year, month, day)
        mid = str(row.get("id") or "").strip()
        if mid and stamp >= SINCE:
            out.append(row)
    return out


def canon_keys(kind: str) -> set[str]:
    import psycopg2

    url = CANON.load_env_db()
    if not url:
        raise SystemExit("DATABASE_URL missing")
    conn = psycopg2.connect(url)
    try:
        cur = conn.cursor()
        cur.execute(
            'SELECT "matchKey" FROM "CanonMatch" WHERE kind = %s AND "matchKey" IS NOT NULL',
            (kind,),
        )
        return {str(r[0]) for r in cur.fetchall() if r[0]}
    finally:
        conn.close()


def fill_train() -> int:
    have = canon_keys("TRAIN")
    added = 0
    folder = DATA / "training"
    if not folder.is_dir():
        print("fill TRAIN: no disk folder")
        return 0
    for path in sorted(folder.glob("????-??.json")):
        m = re.fullmatch(r"(\d{4})-(\d{2})\.json", path.name)
        if not m:
            continue
        year, month = int(m.group(1)), int(m.group(2))
        label = f"{m.group(1)}-{m.group(2)}"
        doc = json.loads(path.read_text(encoding="utf-8"))
        for row in played(doc, year, month):
            mid = str(row.get("id"))
            srv = row.get("serverKey") or row.get("server")
            key = CANON.make_match_key(
                year,
                month,
                int(row.get("day") or 0),
                str(srv) if srv else None,
                str(row.get("map") or ""),
                row.get("timeMsk") or row.get("time"),
            )
            if key in have:
                continue
            players = folder / "players" / f"{mid}.json"
            cid = CANON.upsert_train_row(
                label,
                row,
                players_path=players if players.is_file() else None,
                source="IMPORT_JSON",
            )
            print(f"fill TRAIN {mid} -> {cid or 'skip'}")
            if cid:
                added += 1
                have.add(key)
    print(f"fill TRAIN added={added}")
    return added


def fill_cw() -> int:
    have = canon_keys("CW")
    added = 0
    if not DATA.is_dir():
        print("fill CW: no disk folder")
        return 0
    for path in sorted(DATA.glob("????-??.json")):
        m = re.fullmatch(r"(\d{4})-(\d{2})\.json", path.name)
        if not m:
            continue
        year, month = int(m.group(1)), int(m.group(2))
        doc = json.loads(path.read_text(encoding="utf-8"))
        for row in played(doc, year, month):
            mid = str(row.get("id"))
            srv = row.get("serverKey") or row.get("server")
            key = CANON.make_match_key(
                year,
                month,
                int(row.get("day") or 0),
                str(srv) if srv else None,
                str(row.get("map") or ""),
                row.get("timeMsk") or row.get("time"),
                mid,
                "CW",
            )
            if key in have:
                continue
            players_path = DATA / "players" / f"{mid}.json"
            players_doc = {}
            if players_path.is_file():
                players_doc = json.loads(players_path.read_text(encoding="utf-8"))
            cid = CANON.upsert_cw_final(
                row,
                players_doc,
                source="IMPORT_JSON",
                require_finalize=False,
            )
            print(f"fill CW {mid} -> {cid or 'skip'}")
            if cid:
                added += 1
                have.add(key)
    print(f"fill CW added={added}")
    return added


def main() -> int:
    fill_train()
    fill_cw()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
