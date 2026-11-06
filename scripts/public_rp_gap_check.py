#!/usr/bin/env python3
"""Every few minutes: if a finished public match is missing from the ladder, score it.

The collector already scores on its own tick. This is the backstop when that
tick was skipped or the database write failed after the file was saved.
"""

from __future__ import annotations

import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
LOCK = HERE / "_tmp_public_rp.lock"
LOCK_TTL = 600
LAG = timedelta(minutes=3)


def _busy() -> bool:
    try:
        if not LOCK.is_file():
            return False
        age = time.time() - LOCK.stat().st_mtime
        if age > LOCK_TTL:
            return False
        return True
    except OSError:
        return False


def _ended_ahead() -> bool:
    sys.path.insert(0, str(HERE))
    import canon_match_write as CANON  # noqa: WPS433

    db = CANON.load_env_db()
    if not db:
        print("gap check: no database url", flush=True)
        return False
    import psycopg2

    with psycopg2.connect(db) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT "updatedAt" FROM "RpMeta" WHERE scope = 'PUBLIC'
                """
            )
            meta = cur.fetchone()
            cur.execute(
                """
                SELECT MAX("endedAt") FROM "PublicMatch"
                WHERE "serverKey" IN ('TPUB1', 'PB1', 'PUB')
                """
            )
            ended = cur.fetchone()
    if not ended or ended[0] is None:
        return False
    end = ended[0]
    if end.tzinfo is None:
        end = end.replace(tzinfo=timezone.utc)
    now = datetime.now(timezone.utc)
    if end > now - LAG:
        return False
    if not meta or meta[0] is None:
        return True
    published = meta[0]
    if published.tzinfo is None:
        published = published.replace(tzinfo=timezone.utc)
    return end > published + LAG


def _heal_profile_holes() -> None:
    """Rating can move while one match never reaches profile history."""
    sys.path.insert(0, str(HERE))
    import publish_public_surfaces as PUBLISH  # noqa: WPS433

    n = PUBLISH.heal_recent_profile_holes()
    if n:
        print(f"gap check: filled profile holes rows={n}", flush=True)


def main() -> int:
    if _busy():
        print("gap check: scoring already running", flush=True)
        return 0
    try:
        _heal_profile_holes()
    except Exception as e:
        print(f"gap check: profile hole fill failed: {type(e).__name__}: {e}", flush=True)
    try:
        ahead = _ended_ahead()
    except Exception as e:
        print(f"gap check failed: {type(e).__name__}: {e}", flush=True)
        return 1
    if not ahead:
        print("gap check: public ladder is current", flush=True)
        return 0
    print("gap check: finished match is ahead of the ladder, scoring", flush=True)
    script = HERE / "build_public_rp_ledger.py"
    proc = subprocess.run([sys.executable, str(script)], cwd=str(HERE.parent))
    return int(proc.returncode or 0)


if __name__ == "__main__":
    raise SystemExit(main())
