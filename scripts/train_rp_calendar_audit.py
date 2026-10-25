#!/usr/bin/env python3
"""Audit TRAIN calendar ↔ RP ladder id gaps.

Reports calendar matches (with tickets) missing from rp-ladder, and ladder ids
missing from the month calendar. Exit 1 if calendar→RP gaps exist.

Usage:
  python3 scripts/train_rp_calendar_audit.py
  python3 scripts/train_rp_calendar_audit.py --json
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent


def _train_dirs() -> list[Path]:
    import os

    out: list[Path] = []
    for raw in (
        os.environ.get("BB_KV_PUBLIC"),
        os.environ.get("KV_LOCAL_DIR"),
        "/var/www/blackberry-kv",
        "/var/www/bb-squad-platform/data/kv-cache",
        str(ROOT / "data" / "kv-cache"),
        str(HERE.parents[1] / "KV" / "public"),
    ):
        if not raw:
            continue
        p = Path(raw)
        for c in (p / "data" / "training", p / "public" / "data" / "training", p):
            if (c / "rp-ladder.json").is_file() or list(c.glob("????-??.json")):
                if c not in out:
                    out.append(c)
    return out


def load_calendar_matches(train: Path) -> list[dict]:
    rows: list[dict] = []
    for path in sorted(train.glob("????-??.json")):
        try:
            doc = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            continue
        ym = path.stem  # 2026-10
        for m in doc.get("matches") or []:
            mid = str(m.get("id") or "").strip()
            if not mid:
                continue
            day = int(m.get("day") or 0)
            rows.append(
                {
                    "id": mid,
                    "ym": ym,
                    "day": day,
                    "date": f"{ym}-{day:02d}" if day else None,
                    "map": m.get("map"),
                    "timeMsk": m.get("timeMsk"),
                    "ticketsA": m.get("ticketsA"),
                    "ticketsB": m.get("ticketsB"),
                    "winner": m.get("winner"),
                    "playersUrl": m.get("playersUrl"),
                    "status": m.get("status"),
                }
            )
    return rows


def has_score(m: dict) -> bool:
    ta, tb = m.get("ticketsA"), m.get("ticketsB")
    if ta is None and tb is None:
        return False
    try:
        return int(ta or 0) > 0 or int(tb or 0) > 0
    except Exception:
        return False


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    trains = _train_dirs()
    if not trains:
        print("no training dir", file=sys.stderr)
        return 2
    # Prefer dir that has both ladder and month files
    train = trains[0]
    for t in trains:
        if (t / "rp-ladder.json").is_file() and list(t.glob("????-??.json")):
            train = t
            break

    ladder_path = train / "rp-ladder.json"
    ladder_ids: set[str] = set()
    if ladder_path.is_file():
        L = json.loads(ladder_path.read_text(encoding="utf-8"))
        ladder_ids = {str(m.get("id")) for m in (L.get("matches") or []) if m.get("id")}

    auto_ids: set[str] = set()
    auto_path = train / "_auto_matches.json"
    if auto_path.is_file():
        try:
            auto_ids = {
                str(m.get("id"))
                for m in (json.loads(auto_path.read_text(encoding="utf-8")) or [])
                if m.get("id") and not m.get("skip")
            }
        except Exception:
            pass

    cal = load_calendar_matches(train)
    cal_ids = {m["id"] for m in cal}

    missing_rp = [
        m
        for m in cal
        if has_score(m)
        and m["id"] not in ladder_ids
        and str(m.get("status") or "done") not in ("upcoming", "cancel", "cancelled")
    ]
    orphan_rp = sorted(ladder_ids - cal_ids)
    missing_auto = [m for m in missing_rp if m["id"] not in auto_ids]

    report = {
        "trainDir": str(train),
        "calendarMatches": len(cal),
        "ladderMatches": len(ladder_ids),
        "autoMatches": len(auto_ids),
        "calendarWithScoreMissingRp": len(missing_rp),
        "missingRpIds": [m["id"] for m in missing_rp],
        "missingAlsoNotInAuto": [m["id"] for m in missing_auto],
        "ladderNotInCalendar": orphan_rp,
        "missingRpRows": missing_rp,
    }

    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        print(f"train={train}")
        print(
            f"cal={len(cal)} ladder={len(ladder_ids)} auto={len(auto_ids)} "
            f"gaps_cal→rp={len(missing_rp)} orphans_rp→cal={len(orphan_rp)}"
        )
        for m in missing_rp[:40]:
            print(
                f"  GAP {m['id']} day={m.get('day')} t={m.get('ticketsA')}:{m.get('ticketsB')} "
                f"auto={'Y' if m['id'] in auto_ids else 'N'} map={m.get('map')}"
            )
        if len(missing_rp) > 40:
            print(f"  … +{len(missing_rp) - 40} more")
        if orphan_rp[:15]:
            print("orphan RP (not in calendar):", ", ".join(orphan_rp[:15]))

    return 1 if missing_rp else 0


if __name__ == "__main__":
    raise SystemExit(main())
