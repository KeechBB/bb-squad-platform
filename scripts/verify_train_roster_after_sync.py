#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Post sync_kv_cache: month rows must keep their players/*.json on disk.

Called from sync_kv_cache.sh. Exit 0 always (warn-only) unless --strict.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path


def _real(doc: dict) -> bool:
    n = len(doc.get("teamA") or []) + len(doc.get("teamB") or [])
    if n:
        return True
    pl = doc.get("players") or doc.get("total") or []
    if isinstance(pl, dict):
        return len(pl) >= 8
    return isinstance(pl, list) and len(pl) >= 8


def audit(dest: Path) -> list[str]:
    train = dest / "data" / "training"
    players = train / "players"
    bad: list[str] = []
    if not train.is_dir():
        return ["no data/training"]
    for month_path in sorted(train.glob("????-??.json")):
        try:
            data = json.loads(month_path.read_text(encoding="utf-8"))
        except Exception as e:
            bad.append(f"{month_path.name}: read fail {e}")
            continue
        for row in data.get("matches") or []:
            if not isinstance(row, dict):
                continue
            mid = str(row.get("id") or "").strip()
            if not mid or mid.endswith("-skip"):
                continue
            status = str(row.get("status") or "done").lower()
            if status in ("cancel", "move", "upcoming", "pending-stats", "pending"):
                continue
            path = players / f"{mid}.json"
            if not path.is_file():
                bad.append(f"{mid}: missing players JSON")
                continue
            try:
                doc = json.loads(path.read_text(encoding="utf-8"))
            except Exception:
                bad.append(f"{mid}: broken players JSON")
                continue
            if not _real(doc):
                bad.append(f"{mid}: empty roster")
    return bad


def main() -> int:
    args = [a for a in sys.argv[1:] if a]
    strict = "--strict" in args
    dest = Path(next((a for a in args if not a.startswith("--")), "") or ".")
    bad = audit(dest)
    if not bad:
        print(f"==> train roster verify OK ({dest})")
        return 0
    print(f"==> WARN train roster gaps ({len(bad)}) under {dest}:", flush=True)
    for line in bad[:40]:
        print(f"  - {line}", flush=True)
    return 2 if strict else 0


if __name__ == "__main__":
    raise SystemExit(main())
