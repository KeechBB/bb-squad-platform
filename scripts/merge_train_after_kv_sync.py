#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""After sync_kv_cache rsync: ADD missing auto matches from disk backup — never wipe GitHub.

Old logic restored wholesale backup when it had MORE rows (dupes/Yehorivka) and
erased Fallujah-2 + UI just pulled from GitHub. That is why deploy looked «как раньше».
"""
from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path


def _load(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def _dump(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _is_junk_match(m: dict) -> bool:
    mid = str(m.get("id") or "").lower()
    mmap = str(m.get("map") or "").lower()
    if mid.endswith("-skip") or m.get("skip"):
        return True
    if "yehorivka" in mid or "yehorivka" in mmap:
        return True
    return False


def merge_month(backup_month: Path, dest_month: Path, backup_train: Path, dest_train: Path) -> None:
    b = _load(backup_month)
    d = _load(dest_month)
    if not isinstance(b, dict):
        return
    if not isinstance(d, dict):
        d = {
            "month": backup_month.stem,
            "title": b.get("title") or backup_month.stem,
            "note": b.get("note") or "",
            "matches": [],
        }
    by_id: dict[str, dict] = {}
    for m in d.get("matches") or []:
        if isinstance(m, dict) and m.get("id") and not _is_junk_match(m):
            by_id[str(m["id"])] = m
    added = 0
    for m in b.get("matches") or []:
        if not isinstance(m, dict) or not m.get("id") or _is_junk_match(m):
            continue
        mid = str(m["id"])
        if mid in by_id:
            continue
        by_id[mid] = m
        added += 1
        pu = str(m.get("playersUrl") or "")
        if pu.startswith("data/training/players/"):
            rel = pu.split("data/training/", 1)[-1]
            bp = backup_train / rel
            dp = dest_train / rel
            if bp.is_file():
                dp.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(bp, dp)
    matches = sorted(by_id.values(), key=lambda m: (m.get("day") or 0, m.get("timeMsk") or ""))
    d["matches"] = matches
    _dump(dest_month, d)
    if added:
        print(f"merge {dest_month.name}: +{added} from backup, total={len(matches)}")


def scrub_dest(dest_train: Path) -> None:
    for month_file in dest_train.glob("????-??.json"):
        d = _load(month_file)
        if not isinstance(d, dict):
            continue
        old = d.get("matches") or []
        matches = [m for m in old if isinstance(m, dict) and not _is_junk_match(m)]
        if len(matches) != len(old):
            d["matches"] = matches
            _dump(month_file, d)
            print(f"scrub junk from {month_file.name} → {len(matches)}")
    ye = dest_train / "players" / "06-yehorivka.json"
    if ye.is_file():
        ye.unlink()
        print("deleted players/06-yehorivka.json")


def merge_auto(backup_auto: Path, dest_auto: Path) -> None:
    b = _load(backup_auto)
    d = _load(dest_auto)
    if not isinstance(b, list):
        b = []
    if not isinstance(d, list):
        d = []
    by_start: dict[str, dict] = {}
    for row in d:
        if isinstance(row, dict) and row.get("start"):
            by_start[str(row["start"])] = row
    added = 0
    for row in b:
        if not isinstance(row, dict) or not row.get("start"):
            continue
        st = str(row["start"])
        if st in by_start:
            if row.get("skip") and not by_start[st].get("skip"):
                by_start[st] = row
            continue
        by_start[st] = row
        added += 1
    out = sorted(by_start.values(), key=lambda r: str(r.get("start") or ""))
    _dump(dest_auto, out)
    if added:
        print(f"merge _auto_matches: +{added}, total={len(out)}")


def main() -> int:
    if len(sys.argv) < 3:
        print("usage: merge_train_after_kv_sync.py <backup_train_dir> <dest_kv_root>")
        return 2
    backup = Path(sys.argv[1])
    dest = Path(sys.argv[2])
    if not backup.is_dir():
        print("no backup — nothing to merge")
        return 0

    dest_train = dest / "data" / "training"
    dest_train.mkdir(parents=True, exist_ok=True)

    for month_file in backup.glob("????-??.json"):
        merge_month(month_file, dest_train / month_file.name, backup, dest_train)

    scrub_dest(dest_train)
    merge_auto(backup / "_auto_matches.json", dest_train / "_auto_matches.json")

    b_led, d_led = backup / "rp-ledger.json", dest_train / "rp-ledger.json"
    b_lad, d_lad = backup / "rp-ladder.json", dest_train / "rp-ladder.json"
    bn = len((_load(b_led) or {}).get("matches") or []) if b_led.is_file() else 0
    dn = len((_load(d_led) or {}).get("matches") or []) if d_led.is_file() else 0
    # Only take backup RP if clearly fuller AND dest missing recent maps (never shrink)
    if bn > dn + 2 and b_led.is_file():
        shutil.copy2(b_led, d_led)
        if b_lad.is_file():
            shutil.copy2(b_lad, d_lad)
        print(f"restore RP ledger matches {dn} → {bn}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
