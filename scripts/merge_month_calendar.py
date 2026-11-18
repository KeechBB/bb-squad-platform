#!/usr/bin/env python3
"""
Merge-patch a CW month calendar by match id. NEVER full-overwrite live JSON.

Usage:
  python3 scripts/merge_month_calendar.py \
    --live /var/www/bb-squad-platform/data/kv-cache/data/2026-11.json \
    --patch /tmp/18-faq-patch.json

Patch file = either a full month JSON (matches merged by id) or
{"matches":[{...one slot...}]} / a single match object.
"""
from __future__ import annotations

import argparse
import json
import shutil
from datetime import datetime
from pathlib import Path


def load(p: Path):
    return json.loads(p.read_text(encoding="utf-8"))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--live", required=True, type=Path)
    ap.add_argument("--patch", required=True, type=Path)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    if not args.live.is_file():
        raise SystemExit(f"live missing: {args.live}")
    live = load(args.live)
    patch_raw = load(args.patch)

    if isinstance(patch_raw, dict) and "matches" in patch_raw:
        patch_matches = patch_raw["matches"]
    elif isinstance(patch_raw, list):
        patch_matches = patch_raw
    elif isinstance(patch_raw, dict) and patch_raw.get("id"):
        patch_matches = [patch_raw]
    else:
        raise SystemExit("patch must be month JSON, matches list, or one match object")

    by_id = {str(m.get("id")): m for m in (live.get("matches") or []) if m.get("id")}
    before = len(by_id)
    updated = added = 0
    for pm in patch_matches:
        mid = str(pm.get("id") or "")
        if not mid:
            continue
        if mid in by_id:
            by_id[mid].update(pm)
            updated += 1
        else:
            by_id[mid] = pm
            added += 1

    live["matches"] = list(by_id.values())
    after = len(live["matches"])
    print(f"before={before} after={after} updated={updated} added={added}")
    if after < before:
        raise SystemExit("REFUSE: merge would shrink calendar — abort")
    if args.dry_run:
        print("dry-run OK")
        return

    bak = args.live.with_suffix(args.live.suffix + f".bak-merge-{datetime.now():%H%M%S}")
    shutil.copy2(args.live, bak)
    args.live.write_text(json.dumps(live, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("wrote", args.live, "bak", bak.name)


if __name__ == "__main__":
    main()
