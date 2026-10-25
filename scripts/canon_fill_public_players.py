#!/usr/bin/env python3
"""Phase 9: fill CanonMatchPlayer for PUBLIC rows from siphon layer slices.

Usage:
  python3 scripts/canon_fill_public_players.py --limit 80
  python3 scripts/canon_fill_public_players.py --match-key 2026-10-25_pb1_...
"""

from __future__ import annotations

import argparse
import json
import os
import secrets
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import canon_match_write as CANON  # noqa: E402
import canon_verify_match as V  # noqa: E402
import rp_log_parse as R  # noqa: E402


def _new_id() -> str:
    return "c" + secrets.token_hex(12)


def roster_from_slice(slice_dir: Path) -> list[dict[str, Any]]:
    """Build player rows (nick, kills, deaths, nok, side A/B) from a siphon slice."""
    layer = slice_dir / "layer.log"
    meta_path = slice_dir / "meta.json"
    log_path: Path | None = None
    t0 = t1 = None
    archive = V.ARCHIVE

    if layer.is_file() and layer.stat().st_size > 100:
        log_path = layer
    if meta_path.is_file():
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
            t0 = datetime.fromisoformat(meta["start"].replace("Z", "+00:00"))
            t1 = datetime.fromisoformat(meta["end"].replace("Z", "+00:00"))
            if log_path is None:
                ref = (slice_dir / "source.ref").read_text(encoding="utf-8").strip()
                cand = archive / ref if not Path(ref).is_file() else Path(ref)
                if cand.is_file():
                    log_path = cand
        except Exception:
            pass
    if log_path is None:
        return []

    if t0 is None or t1 is None:
        t0 = datetime(2020, 1, 1, tzinfo=timezone.utc)
        t1 = datetime(2099, 1, 1, tzinfo=timezone.utc)

    aliases: dict[str, str] = {}
    idx = R.index_log_combat(log_path, aliases)
    steam = dict(idx.get("steam_to_nick") or {})
    teams = R.teams_in_window(idx, t0, t1, {})
    dies, _ = R.dies_in_window(idx, t0, t1, steam, aliases)
    wounds = R.wounds_in_window(idx, t0, t1, steam, aliases)
    revives = R.revives_in_window(idx, t0, t1)
    disp = {R.canon_key(n, aliases): n for n in steam.values()}

    stats: dict[str, dict[str, Any]] = {}

    def row(k: str, nick: str) -> dict[str, Any]:
        if k not in stats:
            side = teams.get(k)
            if side in ("A", "B", "1", "2"):
                side = "A" if side in ("A", "1") else "B"
            else:
                side = "U"
            stats[k] = {
                "nick": nick,
                "side": side,
                "round": 0,
                "kills": 0,
                "deaths": 0,
                "nok": 0,
                "res": 0,
                "dmg": 0.0,
            }
        return stats[k]

    for w in wounds or []:
        kk, vk = w.get("killerKey"), w.get("victimKey")
        if not kk or not vk or kk == vk:
            continue
        row(kk, w.get("killer") or disp.get(kk, kk))["nok"] += 1
        row(kk, w.get("killer") or kk)["dmg"] += float(w.get("dmg") or 0)
        row(vk, w.get("victim") or disp.get(vk, vk))

    for d in dies or []:
        kk, vk = d.get("killerKey"), d.get("victimKey")
        if not kk or not vk or kk == vk:
            continue
        row(kk, d.get("killer") or disp.get(kk, kk))["kills"] += 1
        row(vk, d.get("victim") or disp.get(vk, vk))["deaths"] += 1

    for r in revives or []:
        mk = r.get("medicKey") or r.get("reviverKey")
        if mk:
            row(mk, r.get("medic") or r.get("reviver") or disp.get(mk, mk))["res"] += 1

    out: list[dict[str, Any]] = []
    for st in stats.values():
        out.append(
            {
                "nick": st["nick"],
                "side": st["side"],
                "round": 0,
                "kills": int(st["kills"]),
                "deaths": int(st["deaths"]),
                "nok": int(st["nok"]),
                "res": int(st["res"]),
                "dmg": float(st["dmg"]) or None,
            }
        )
    return out


def fill_match(match: dict[str, Any], *, force: bool = False) -> int:
    db = CANON.load_env_db()
    if not db:
        return 0
    import psycopg2
    from psycopg2.extras import Json

    mid = match["id"]
    key = match["matchKey"]
    with psycopg2.connect(db) as conn:
        with conn.cursor() as cur:
            cur.execute(
                'SELECT count(*) FROM "CanonMatchPlayer" WHERE "matchId"=%s', (mid,)
            )
            n = int(cur.fetchone()[0])
            if n > 0 and not force:
                return 0

    slices = V.find_slice_dirs(
        key,
        day=f"{match['year']:04d}-{match['month']:02d}-{int(match['day']):02d}",
        server=match.get("serverKey"),
        map_name=match.get("mapName"),
    )
    if not slices:
        return 0
    players = roster_from_slice(slices[0])
    if len(players) < 4:
        return 0

    with psycopg2.connect(db) as conn:
        with conn.cursor() as cur:
            cur.execute(
                'DELETE FROM "CanonMatchPlayer" WHERE "matchId"=%s', (mid,)
            )
            for p in players:
                cur.execute(
                    """
                    INSERT INTO "CanonMatchPlayer" (
                      id, "matchId", side, round, nick,
                      kills, deaths, nok, res, dmg
                    ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                    ON CONFLICT ("matchId", nick, round, side) DO NOTHING
                    """,
                    (
                        _new_id(),
                        mid,
                        p.get("side"),
                        p.get("round") if p.get("round") is not None else 0,
                        p["nick"],
                        int(p.get("kills") or 0),
                        int(p.get("deaths") or 0),
                        int(p.get("nok") or 0),
                        int(p.get("res") or 0),
                        p.get("dmg"),
                    ),
                )
            cur.execute(
                'UPDATE "CanonMatch" SET "updatedAt"=%s WHERE id=%s',
                (datetime.now(timezone.utc), mid),
            )
        conn.commit()
    return len(players)


def list_public(
    limit: int, *, needing_only: bool = True
) -> list[dict[str, Any]]:
    db = CANON.load_env_db()
    if not db:
        return []
    import psycopg2
    from psycopg2.extras import RealDictCursor

    with psycopg2.connect(db) as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            if needing_only:
                cur.execute(
                    """
                    SELECT m.*
                    FROM "CanonMatch" m
                    WHERE m.kind = 'PUBLIC'::"CanonMatchKind"
                      AND NOT EXISTS (
                        SELECT 1 FROM "CanonMatchPlayer" p WHERE p."matchId" = m.id
                      )
                    ORDER BY m."endedAt" DESC NULLS LAST, m."updatedAt" DESC
                    LIMIT %s
                    """,
                    (limit,),
                )
            else:
                cur.execute(
                    """
                    SELECT m.*
                    FROM "CanonMatch" m
                    WHERE m.kind = 'PUBLIC'::"CanonMatchKind"
                    ORDER BY m."endedAt" DESC NULLS LAST, m."updatedAt" DESC
                    LIMIT %s
                    """,
                    (limit,),
                )
            return [dict(r) for r in cur.fetchall()]


def list_public_needing(limit: int) -> list[dict[str, Any]]:
    return list_public(limit, needing_only=True)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--limit", type=int, default=80)
    ap.add_argument("--match-key")
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()

    if args.match_key:
        m = V.fetch_match(match_key=args.match_key)
        if not m:
            print("not found", file=sys.stderr)
            return 1
        n = fill_match(m, force=args.force)
        print(f"{args.match_key} players={n}")
        return 0 if n else 2

    rows = list_public(args.limit, needing_only=not args.force)
    filled = 0
    total_pl = 0
    for m in rows:
        n = fill_match(m, force=args.force)
        if n:
            filled += 1
            total_pl += n
            print(f"+ {m['matchKey']} players={n}", flush=True)
    print(f"done matches={filled}/{len(rows)} players={total_pl}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
