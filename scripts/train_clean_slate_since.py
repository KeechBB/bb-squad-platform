#!/usr/bin/env python3
"""Clean-slate TRAIN site data, keep match detail JSONs, cutover from a date.

Keeps players/*.json for pre-cutover matches under players/_kept_detail_*/.
Wipes calendar / auto / RP ladder+ledger (TRAIN). Does NOT touch CW or PUBLIC.

Usage:
  BB_KV_PUBLIC=/var/www/bb-squad-platform/data/kv-cache \\
    python3 scripts/train_clean_slate_since.py --since 2026-10-20
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))


def resolve_roots() -> list[Path]:
    env = (os.environ.get("BB_KV_PUBLIC") or "").strip()
    roots: list[Path] = []
    if env:
        roots.append(Path(env))
    roots += [
        Path("/var/www/bb-squad-platform/data/kv-cache"),
        Path("/var/www/blackberry-kv"),
        Path("/var/www/blackberry-kv/public"),
    ]
    out: list[Path] = []
    seen: set[str] = set()
    for r in roots:
        try:
            key = str(r.resolve())
        except OSError:
            key = str(r)
        if key in seen or not (r / "data" / "training").is_dir():
            continue
        seen.add(key)
        out.append(r)
    return out


def match_date(row: dict, auto_by_id: dict[str, dict]) -> str | None:
    mid = str(row.get("id") or "")
    am = auto_by_id.get(mid) or {}
    d = str(am.get("date") or row.get("date") or "").strip()
    if len(d) >= 10 and d[4] == "-":
        return d[:10]
    # month file often has day only — use auto start
    start = str(am.get("start") or row.get("start") or "").strip()
    if start:
        try:
            dt = datetime.fromisoformat(start.replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            msk = dt.timestamp() + 3 * 3600
            return datetime.utcfromtimestamp(msk).strftime("%Y-%m-%d")
        except Exception:
            pass
    return None


def wipe_root(root: Path, since: str) -> dict:
    train = root / "data" / "training"
    players = train / "players"
    archive = players / f"_kept_detail_pre_{since.replace('-', '')}"
    archive.mkdir(parents=True, exist_ok=True)

    auto_path = train / "_auto_matches.json"
    auto: list[dict] = []
    auto_by_id: dict[str, dict] = {}
    if auto_path.is_file():
        try:
            auto = json.loads(auto_path.read_text(encoding="utf-8")) or []
        except Exception:
            auto = []
    for am in auto:
        if isinstance(am, dict) and am.get("id"):
            auto_by_id[str(am["id"])] = am

    # Full calendar wipe — sync from logs since cutover re-fills history.
    # Player detail JSONs are archived (clickable drilldown preserved on disk).
    drop_ids: set[str] = set()
    for am in auto:
        if isinstance(am, dict) and am.get("id"):
            drop_ids.add(str(am["id"]))

    kept_month_rows = 0
    dropped_month_rows = 0
    for month_path in sorted(train.glob("????-??.json")):
        try:
            data = json.loads(month_path.read_text(encoding="utf-8"))
        except Exception:
            continue
        rows = data.get("matches") or []
        dropped_month_rows += len(rows)
        for row in rows:
            if isinstance(row, dict) and row.get("id"):
                drop_ids.add(str(row["id"]))
        data["matches"] = []
        month_path.write_text(
            json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )

    moved = 0
    for path in list(players.glob("*.json")):
        mid = path.stem
        if mid.startswith("_"):
            continue
        dest = archive / path.name
        if dest.exists():
            dest.unlink()
        shutil.move(str(path), str(dest))
        moved += 1
        drop_ids.add(mid)

    kept_auto: list[dict] = []
    auto_path.write_text("[]\n", encoding="utf-8")

    # Empty TRAIN RP aggregates (site rating)
    for name in ("rp-ladder.json", "rp-ledger.json", "vehicle-hit-stats.json"):
        p = train / name
        if name.startswith("rp-"):
            empty = {
                "meta": {
                    "resetAt": datetime.now(timezone.utc).isoformat(),
                    "since": since,
                    "note": "train clean slate",
                },
                "players": {},
                "matches": [],
                "leaderboard": [],
            }
            if "ledger" in name:
                empty = {
                    "meta": empty["meta"],
                    "matches": [],
                    "players": {},
                }
            p.write_text(
                json.dumps(empty, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
            )
        elif p.exists():
            p.write_text(
                json.dumps(
                    {
                        "meta": {"resetAt": datetime.now(timezone.utc).isoformat(), "since": since},
                        "byNick": {},
                    },
                    ensure_ascii=False,
                    indent=2,
                )
                + "\n",
                encoding="utf-8",
            )

    # pending queue
    pending = train / "_rp_pending.json"
    if pending.exists():
        pending.write_text("[]\n", encoding="utf-8")

    return {
        "root": str(root),
        "kept_auto": len(kept_auto),
        "drop_ids": len(drop_ids),
        "kept_month_rows": kept_month_rows,
        "dropped_month_rows": dropped_month_rows,
        "moved_players": moved,
        "archive": str(archive),
    }


def wipe_train_db() -> dict:
    """Clear TRAIN rows in Postgres RP tables (soft-fail)."""
    try:
        import canon_match_write as CANON

        db = CANON.load_env_db()
        if not db:
            return {"ok": False, "reason": "no db"}
        import psycopg2

        conn = psycopg2.connect(db)
        cur = conn.cursor()
        # Phase 10 slim tables — names from schema
        deleted = {}
        for table, where in (
            ('"RpLadderPlayer"', "scope = 'TRAIN'"),
            ('"RpScoredMatch"', "scope = 'TRAIN'"),
            ('"RpMeta"', "scope = 'TRAIN'"),
        ):
            try:
                cur.execute(f"DELETE FROM {table} WHERE {where}")
                deleted[table] = cur.rowcount
            except Exception as e:
                deleted[table] = f"err:{e}"
                conn.rollback()
                continue
        conn.commit()
        conn.close()
        return {"ok": True, "deleted": deleted}
    except Exception as e:
        return {"ok": False, "reason": str(e)}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--since", default="2026-10-20")
    ap.add_argument("--skip-db", action="store_true")
    args = ap.parse_args()
    since = args.since
    reports = []
    for root in resolve_roots():
        rep = wipe_root(root, since)
        reports.append(rep)
        print(json.dumps(rep, ensure_ascii=False))
    if not args.skip_db:
        db = wipe_train_db()
        print("db", db)
    print("done roots", len(reports))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
