#!/usr/bin/env python3
"""Publish one TRAIN/CW match from kv-cache JSON into CanonMatch (plaza).

After screenshot digitization (or manual JSON edit), run on VPS:

  python3 scripts/canon_publish_match.py \\
    --root /var/www/bb-squad-platform/data/kv-cache/data \\
    --kind CW --id 26-omen --month 2026-10 --source SCREENSHOT

  python3 scripts/canon_publish_match.py \\
    --root ... --kind TRAIN --id 25-cslmutaha --month 2026-10 --source SCREENSHOT
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import canon_match_write as CANON  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "--root",
        default="/var/www/bb-squad-platform/data/kv-cache/data",
        help="kv-cache data root (training/ + players/ + YYYY-MM.json)",
    )
    ap.add_argument("--kind", required=True, choices=["TRAIN", "CW", "train", "cw"])
    ap.add_argument("--id", required=True, dest="legacy_id", help="legacy match id")
    ap.add_argument("--month", required=True, help="YYYY-MM")
    ap.add_argument(
        "--source",
        default="SCREENSHOT",
        choices=["SCREENSHOT", "LOG", "IMPORT_JSON"],
    )
    args = ap.parse_args()
    root = Path(args.root)
    if not root.is_dir():
        print(f"root not found: {root}", file=sys.stderr)
        return 1
    cid = CANON.publish_match_from_kv(
        root=root,
        kind=args.kind,
        legacy_id=args.legacy_id,
        month=args.month,
        source=args.source,
    )
    if not cid:
        print("canon upsert failed / skipped", file=sys.stderr)
        return 2
    print(f"ok {args.kind.upper()} {args.legacy_id} → {cid}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
