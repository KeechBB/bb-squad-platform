#!/usr/bin/env python3
"""Pre-build training combat cards for given month days (profile «Детальный разбор»)."""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
TRAIN = Path("/var/www/bb-squad-platform/data/kv-cache/data/training")
SCRIPT = HERE / "train_combat_card.py"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--month", default="2026-10")
    ap.add_argument("--days", default="29,30")
    ap.add_argument("--rebuild", action="store_true")
    args = ap.parse_args()
    days = {int(x) for x in str(args.days).split(",") if x.strip()}
    month_path = TRAIN / f"{args.month}.json"
    data = json.loads(month_path.read_text(encoding="utf-8"))
    ids = [
        str(m.get("id") or "")
        for m in data.get("matches") or []
        if m.get("day") in days and m.get("id")
    ]
    print(f"warm {len(ids)} cards for days={sorted(days)}", flush=True)
    ok = fail = 0
    for mid in ids:
        cmd = [sys.executable, str(SCRIPT), "--id", mid]
        if args.rebuild:
            cmd.append("--rebuild")
        # pick any nick from players file so card is fully built+cached
        pj = TRAIN / "players" / f"{mid}.json"
        nick = ""
        if pj.is_file():
            doc = json.loads(pj.read_text(encoding="utf-8"))
            rows = doc.get("players") or list(doc.get("teamA") or []) + list(
                doc.get("teamB") or []
            )
            for r in rows:
                if isinstance(r, dict) and r.get("nick"):
                    nick = str(r["nick"])
                    break
        if nick:
            cmd += ["--nick", nick]
        print(f"=== {mid} nick={nick or '-'}", flush=True)
        rc = subprocess.call(cmd, cwd=str(ROOT))
        if rc == 0:
            ok += 1
        else:
            fail += 1
            print(f"FAIL {mid} rc={rc}", flush=True)
    print(json.dumps({"ok": ok, "fail": fail, "ids": ids}, ensure_ascii=False), flush=True)
    return 0 if fail == 0 else 2


if __name__ == "__main__":
    raise SystemExit(main())
