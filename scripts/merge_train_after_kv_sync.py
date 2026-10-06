#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""After sync_kv_cache rsync from GitHub: keep richer on-disk training auto-ingest.

Deploy used to wipe Fallujah/RP that collector wrote but GitHub didn't have yet.
Prefer whichever side has MORE month matches / MORE auto starts / MORE RP matches.
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


def _match_n(month_path: Path) -> int:
    d = _load(month_path)
    if not isinstance(d, dict):
        return 0
    return len(d.get("matches") or [])


def _auto_n(auto_path: Path) -> int:
    d = _load(auto_path)
    if not isinstance(d, list):
        return 0
    return len([x for x in d if isinstance(x, dict) and x.get("start")])


def _rp_n(ledger_path: Path) -> int:
    d = _load(ledger_path)
    if not isinstance(d, dict):
        return 0
    return len(d.get("matches") or [])


def restore_tree(src: Path, dst: Path) -> None:
    if not src.exists():
        return
    dst.parent.mkdir(parents=True, exist_ok=True)
    if src.is_dir():
        if dst.exists():
            shutil.rmtree(dst)
        shutil.copytree(src, dst)
    else:
        shutil.copy2(src, dst)


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

    # Month JSON: keep richer
    for month_file in backup.glob("????-??.json"):
        name = month_file.name
        cur = dest_train / name
        bn, cn = _match_n(month_file), _match_n(cur)
        if bn > cn:
            shutil.copy2(month_file, cur)
            print(f"restore {name} matches {cn} → {bn}")
            # restore player files referenced by backup month
            md = _load(month_file) or {}
            for m in md.get("matches") or []:
                pu = str(m.get("playersUrl") or "")
                if not pu.startswith("data/training/players/"):
                    continue
                rel = pu.split("data/training/", 1)[-1]
                bp = backup / rel
                dp = dest_train / rel
                if bp.is_file():
                    dp.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(bp, dp)

    # auto_matches
    b_auto, d_auto = backup / "_auto_matches.json", dest_train / "_auto_matches.json"
    if _auto_n(b_auto) > _auto_n(d_auto):
        shutil.copy2(b_auto, d_auto)
        print(f"restore _auto_matches {_auto_n(d_auto)} → {_auto_n(b_auto)}")

    # RP ledger/ladder
    for name in ("rp-ledger.json", "rp-ladder.json"):
        bp, dp = backup / name, dest_train / name
        if _rp_n(bp) > _rp_n(dp):
            shutil.copy2(bp, dp)
            print(f"restore {name} matches {_rp_n(dp)} → {_rp_n(bp)}")

    # cache-bust / index if backup newer tag
    for rel in (
        Path("data/cache-bust.json"),
        Path("data/training-index.json"),
    ):
        # backup is training dir only — cache-bust lives beside
        pass

    bust_b = backup.parent / "cache-bust.json" if (backup.parent / "cache-bust.json").is_file() else None
    # also accept backup/../cache-bust from full data backup
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
