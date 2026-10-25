#!/usr/bin/env python3
"""Heal TRAIN calendar→RP gaps: ensure auto rows, drain pending RP, sync DB ladder.

Skips obvious non-TR calendar junk (SEC 26 / CW noise) unless --include-sec26.

Usage:
  python3 scripts/train_rp_heal_calendar_gaps.py
  python3 scripts/train_rp_heal_calendar_gaps.py --dry-run
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import train_rp_calendar_audit as AUD  # noqa: E402
import train_rp_guard as TRG  # noqa: E402


def _is_sec26_junk(m: dict) -> bool:
    name = str(m.get("map") or "")
    return "SEC 26" in name.upper() or name.upper().startswith("SEC26")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--include-sec26", action="store_true")
    args = ap.parse_args()

    trains = AUD._train_dirs()
    train = None
    for t in trains:
        if (t / "rp-ladder.json").is_file() and list(t.glob("????-??.json")):
            # Prefer platform kv-cache when present
            if "kv-cache" in str(t).replace("\\", "/"):
                train = t
                break
            if train is None:
                train = t
    if train is None:
        print("no training dir", file=sys.stderr)
        return 2

    # Point builders at this tree
    kv_public = train.parent.parent  # .../data/training → .../data → root; need KV public
    # train = <root>/data/training → root is parents[1]
    kv_public = train.parents[1]
    os.environ["BB_KV_PUBLIC"] = str(kv_public)
    os.environ["KV_LOCAL_DIR"] = str(kv_public)

    print(f"heal train={train} kv_public={kv_public}", flush=True)

    before = AUD.load_calendar_matches(train)
    ladder_path = train / "rp-ladder.json"
    L = json.loads(ladder_path.read_text(encoding="utf-8")) if ladder_path.is_file() else {}
    ladder_ids = {str(m.get("id")) for m in (L.get("matches") or []) if m.get("id")}
    gaps = [
        m
        for m in before
        if AUD.has_score(m)
        and m["id"] not in ladder_ids
        and str(m.get("status") or "done") not in ("upcoming", "cancel", "cancelled")
        and (args.include_sec26 or not _is_sec26_junk(m))
    ]
    print(f"gaps (excl junk unless flagged)={len(gaps)}", flush=True)
    for m in gaps[:25]:
        print(f"  {m['id']} {m.get('map')}", flush=True)

    if args.dry_run:
        needing = TRG.auto_ids_needing_rp(train)
        print(f"dry-run auto_ids_needing_rp={len(needing)} {needing[:20]}")
        return 0 if not gaps else 1

    added = TRG.ensure_auto_from_calendar_pins(train)
    print(f"ensure_auto added={len(added)} {added[:20]}", flush=True)

    drain = TRG.drain_pending(train, kv_public, kind="train")
    print(f"drain={json.dumps(drain, ensure_ascii=False)}", flush=True)

    # If still gaps with logs, force incremental rebuild once
    needing = TRG.auto_ids_needing_rp(train)
    if needing:
        print(f"still needing={len(needing)} → build_train_rp_ledger", flush=True)
        env = os.environ.copy()
        env["BB_KV_PUBLIC"] = str(kv_public)
        rc = subprocess.call(
            [sys.executable, str(HERE / "build_train_rp_ledger.py")],
            cwd=str(HERE.parent),
            env=env,
        )
        print(f"build_train_rp rc={rc}", flush=True)
        TRG.clear_pending_done(train, kind="train")

    try:
        import rp_ladder_db as RPDB  # noqa: WPS433

        RPDB.sync_from_path("TRAIN", train / "rp-ladder.json")
    except Exception as e:
        print(f"rp db sync skip: {e}", flush=True)

    # re-audit
    L2 = json.loads(ladder_path.read_text(encoding="utf-8")) if ladder_path.is_file() else {}
    ladder2 = {str(m.get("id")) for m in (L2.get("matches") or []) if m.get("id")}
    left = [
        m["id"]
        for m in gaps
        if m["id"] not in ladder2
    ]
    print(f"remaining gaps after heal={len(left)} {left[:30]}", flush=True)
    return 0 if not left else 1


if __name__ == "__main__":
    raise SystemExit(main())
