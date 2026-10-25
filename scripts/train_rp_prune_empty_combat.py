#!/usr/bin/env python3
"""Remove TRAIN RP ladder/ledger matches with zero combat (bad pins).

Usage:
  python3 scripts/train_rp_prune_empty_combat.py
  python3 scripts/train_rp_prune_empty_combat.py --dry-run
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))


def _train() -> Path:
    import os

    for raw in (
        os.environ.get("BB_KV_PUBLIC"),
        "/var/www/bb-squad-platform/data/kv-cache",
        "/var/www/blackberry-kv",
    ):
        if not raw:
            continue
        p = Path(raw) / "data" / "training"
        if (p / "rp-ladder.json").is_file():
            return p
    raise SystemExit("no train dir")


def prune_doc(doc: dict) -> tuple[dict, list[str]]:
    drop: list[str] = []
    kept_matches = []
    for m in doc.get("matches") or []:
        mid = str(m.get("id") or "")
        die = int(m.get("giveUpKills") or 0)
        tk = int(m.get("teamkills") or 0)
        rev = int(m.get("revives") or 0)
        nets = m.get("netByNick") or {}
        nonzero = sum(1 for v in nets.values() if abs(float(v or 0)) > 0.01)
        if die == 0 and tk == 0 and rev == 0 and nonzero == 0:
            drop.append(mid)
            continue
        kept_matches.append(m)
    drop_set = set(drop)
    players = doc.get("players") or {}
    for _k, pl in players.items():
        if not isinstance(pl, dict):
            continue
        hist = list(pl.get("matches") or [])
        kept_h = []
        unwind = 0.0
        for hm in hist:
            mid = str(hm.get("id") or "")
            if mid in drop_set:
                try:
                    unwind += float(hm.get("net") or 0)
                except (TypeError, ValueError):
                    pass
                continue
            kept_h.append(hm)
        if unwind:
            try:
                pl["rp"] = round(float(pl.get("rp") or 1000) - unwind, 1)
            except (TypeError, ValueError):
                pass
        pl["matches"] = kept_h
    doc["matches"] = kept_matches
    # rebuild slim leaderboard later by rewrite from build; here just keep order
    return doc, drop


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    train = _train()
    for name in ("rp-ledger.json", "rp-ladder.json"):
        path = train / name
        if not path.is_file():
            continue
        doc = json.loads(path.read_text(encoding="utf-8"))
        new_doc, drop = prune_doc(doc)
        print(f"{name}: drop {len(drop)} {drop[:20]}")
        if args.dry_run or not drop:
            continue
        # rebuild leaderboard from players
        rows = []
        for pl in (new_doc.get("players") or {}).values():
            if not isinstance(pl, dict):
                continue
            rows.append(
                {
                    "nick": pl.get("nick"),
                    "rp": pl.get("rp"),
                    "rankLabel": pl.get("rankLabel"),
                    "rankKey": pl.get("rankKey"),
                    "predatorPlace": pl.get("predatorPlace"),
                }
            )
        rows.sort(key=lambda r: -float(r.get("rp") or 0))
        new_doc["leaderboard"] = rows
        path.write_text(
            json.dumps(new_doc, ensure_ascii=False, separators=(",", ":")) + "\n"
            if name.endswith("ladder.json")
            else json.dumps(new_doc, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
    if not args.dry_run:
        try:
            import rp_ladder_db as RPDB

            RPDB.sync_from_path("TRAIN", train / "rp-ladder.json")
        except Exception as e:
            print(f"db sync skip: {e}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
