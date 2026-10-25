#!/usr/bin/env python3
"""Backfill CanonMatch PUBLIC from existing PublicMatch rows."""

from __future__ import annotations

import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import canon_match_write as CANON  # noqa: E402


def msk_parts(dt: datetime) -> tuple[int, int, int, int, int]:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    msk = dt.astimezone(timezone(timedelta(hours=3)))
    return msk.year, msk.month, msk.day, msk.hour, msk.minute


def main() -> int:
    db = CANON.load_env_db()
    if not db:
        print("no DATABASE_URL", file=sys.stderr)
        return 1
    import psycopg2
    from psycopg2.extras import RealDictCursor

    conn = psycopg2.connect(db)
    n = 0
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                SELECT * FROM "PublicMatch"
                WHERE "serverKey" IN ('TPUB1','PB1','PUB')
                ORDER BY "endedAt" DESC
                LIMIT 2000
                """
            )
            rows = list(cur.fetchall())
        for pm in rows:
            ended = pm["endedAt"]
            if ended.tzinfo is None:
                ended = ended.replace(tzinfo=timezone.utc)
            y, mo, day, h, mi = msk_parts(ended)
            layer = pm.get("layerName") or pm.get("mapName") or "map"
            sk = CANON.server_key_from_label(pm.get("serverKey") or "PB1")
            if sk == "srv":
                sk = "pb1"
            mk = CANON.make_match_key(
                y, mo, day, sk, str(layer), f"{h:02d}:{mi:02d}"
            )
            legacy = str(pm.get("eventKey") or "")[:120]
            wt = int(pm.get("winnerTeam") or 0)
            winner = (
                pm.get("faction1")
                if wt == 1
                else pm.get("faction2")
                if wt == 2
                else pm.get("winnerName")
            )
            cid = CANON._upsert(
                kind="PUBLIC",
                source="LOG",
                match_key=mk,
                legacy_id=legacy or mk,
                year=y,
                month=mo,
                day=day,
                time_msk=f"{h:02d}:{mi:02d}",
                server_key=sk,
                server_label=pm.get("serverKey"),
                map_name=str(layer),
                faction_a=pm.get("faction1"),
                tickets_a=int(pm.get("score1") or 0),
                faction_b=pm.get("faction2"),
                tickets_b=int(pm.get("score2") or 0),
                winner=winner,
                status="done",
                raw_json={
                    "eventKey": pm.get("eventKey"),
                    "publicMatchId": pm.get("id"),
                },
                players=[],
            )
            # also set endedAt
            if cid:
                try:
                    import psycopg2 as pg

                    c2 = pg.connect(db)
                    with c2.cursor() as c:
                        c.execute(
                            'UPDATE "CanonMatch" SET "endedAt"=%s WHERE id=%s',
                            (ended, cid),
                        )
                    c2.commit()
                    c2.close()
                except Exception:
                    pass
                n += 1
        print(f"backfilled PUBLIC canon: {n}/{len(rows)}")
        return 0
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
