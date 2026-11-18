#!/usr/bin/env python3
"""
Atomic JSON replace with anti-shrink guards for critical KV files.

Usage:
  python3 scripts/safe_json_replace.py --live PATH --src PATH [--kind auto|calendar|ladder|index|raw]
  python3 scripts/safe_json_replace.py --live PATH --stdin [--kind ...]

Refuses to replace when the new file would clearly destroy data:
  calendar: fewer matches than live
  ladder:   fewer players than live (and live >= 5)
  index:    drops current YYYY-MM month
  training-index: same
Never uses rsync --delete. Always writes .bak-<HHMMSS> first.
"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
from datetime import datetime
from pathlib import Path


def load(path: Path | None, raw: str | None):
    if raw is not None:
        return json.loads(raw)
    assert path is not None
    return json.loads(path.read_text(encoding="utf-8"))


def dump(obj) -> str:
    return json.dumps(obj, ensure_ascii=False, indent=2) + "\n"


def match_count(obj) -> int:
    if isinstance(obj, dict):
        m = obj.get("matches")
        if isinstance(m, list):
            return len(m)
    if isinstance(obj, list):
        return len(obj)
    return 0


def player_count(obj) -> int:
    if isinstance(obj, list):
        return len(obj)
    if isinstance(obj, dict):
        for k in ("players", "ladder", "rows", "entries"):
            v = obj.get(k)
            if isinstance(v, list):
                return len(v)
    return 0


def months_in_index(obj) -> set[str]:
    out: set[str] = set()
    if not isinstance(obj, dict):
        return out
    months = obj.get("months") or obj.get("byMonth") or []
    if isinstance(months, dict):
        out.update(str(k) for k in months.keys())
    elif isinstance(months, list):
        for m in months:
            if isinstance(m, dict):
                mid = m.get("id") or m.get("month")
                if mid:
                    out.add(str(mid))
            elif m:
                out.add(str(m))
    return out


def detect_kind(path: Path, kind: str) -> str:
    if kind != "auto":
        return kind
    name = path.name
    if name == "training-index.json" or name == "index.json":
        return "index"
    if name.endswith("-ladder.json") or "ladder" in name:
        return "ladder"
    if path.match("**/20[0-9][0-9]-[0-9][0-9].json") and "training" not in str(path):
        return "calendar"
    if "training" in str(path) and path.match("**/20[0-9][0-9]-[0-9][0-9].json"):
        return "calendar"
    return "raw"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--live", required=True, type=Path)
    ap.add_argument("--src", type=Path)
    ap.add_argument("--stdin", action="store_true")
    ap.add_argument("--kind", default="auto", choices=["auto", "calendar", "ladder", "index", "raw"])
    ap.add_argument("--force", action="store_true", help="bypass guards (dangerous)")
    args = ap.parse_args()

    if bool(args.src) == bool(args.stdin):
        print("Provide exactly one of --src or --stdin", file=sys.stderr)
        return 2

    raw = sys.stdin.read() if args.stdin else None
    new_obj = load(args.src, raw)
    kind = detect_kind(args.live, args.kind)

    if args.live.is_file() and not args.force:
        live_obj = load(args.live, None)
        if kind == "calendar":
            ln, nn = match_count(live_obj), match_count(new_obj)
            if nn < ln:
                print(f"REFUSE calendar shrink {args.live}: live={ln} new={nn}", file=sys.stderr)
                return 3
        elif kind == "ladder":
            ln, nn = player_count(live_obj), player_count(new_obj)
            if ln >= 5 and nn < ln:
                print(f"REFUSE ladder shrink {args.live}: live={ln} new={nn}", file=sys.stderr)
                return 3
        elif kind == "index":
            cur = datetime.now().strftime("%Y-%m")
            live_m, new_m = months_in_index(live_obj), months_in_index(new_obj)
            if cur in live_m and cur not in new_m:
                print(f"REFUSE index drop current month {cur} in {args.live}", file=sys.stderr)
                return 3
            if live_m and new_m and len(new_m) < len(live_m):
                print(f"REFUSE index month shrink {args.live}: live={sorted(live_m)} new={sorted(new_m)}", file=sys.stderr)
                return 3

    args.live.parent.mkdir(parents=True, exist_ok=True)
    if args.live.is_file():
        bak = args.live.with_suffix(args.live.suffix + f".bak-safe-{datetime.now():%H%M%S}")
        shutil.copy2(args.live, bak)
        print("bak", bak.name)

    tmp = args.live.with_suffix(args.live.suffix + ".tmp")
    tmp.write_text(dump(new_obj), encoding="utf-8")
    tmp.replace(args.live)
    print("wrote", args.live, "kind", kind)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
