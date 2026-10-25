#!/usr/bin/env python3
"""Phase 10: upsert slim RP ladder (TRAIN/PUBLIC) into Postgres.

Usage:
  python3 scripts/rp_ladder_db.py --scope TRAIN
  python3 scripts/rp_ladder_db.py --scope PUBLIC
  python3 scripts/rp_ladder_db.py --all
  python3 scripts/rp_ladder_db.py --scope PUBLIC --path /path/to/rp-ladder.json

Called after build_*_rp_ledger writes. Soft-fail. Disable: BB_RP_DB_WRITE=0
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
ROOT = HERE.parent
sys.path.insert(0, str(HERE))

import canon_match_write as CANON  # noqa: E402


def _enabled() -> bool:
    return os.environ.get("BB_RP_DB_WRITE", "1").strip().lower() not in (
        "0",
        "false",
        "no",
    )


def _new_id() -> str:
    return "r" + secrets.token_hex(12)


def nick_key(n: str) -> str:
    return "".join(str(n or "").strip().lower().split())


def resolve_ladder_path(scope: str, override: str | None = None) -> Path | None:
    if override:
        p = Path(override)
        return p if p.is_file() else None
    if scope == "TRAIN":
        cands = [
            Path(os.environ.get("BB_KV_PUBLIC") or "") / "data" / "training" / "rp-ladder.json",
            Path("/var/www/blackberry-kv/data/training/rp-ladder.json"),
            Path("/var/www/bb-squad-platform/data/kv-cache/data/training/rp-ladder.json"),
            ROOT / "data" / "kv-cache" / "data" / "training" / "rp-ladder.json",
            HERE.parents[1] / "KV" / "public" / "data" / "training" / "rp-ladder.json",
        ]
    else:
        cands = [
            ROOT / "data" / "public" / "rp-ladder.json",
            Path("/var/www/bb-squad-platform/data/public/rp-ladder.json"),
        ]
    for c in cands:
        if c.is_file() and c.stat().st_size > 100:
            return c
    return None


def upsert_ladder(scope: str, ladder: dict[str, Any]) -> dict[str, int]:
    db = CANON.load_env_db()
    if not db:
        return {"players": 0, "matches": 0}
    import psycopg2
    from psycopg2.extras import Json

    scope_u = scope.upper()
    now = datetime.now(timezone.utc)
    players = ladder.get("players") or {}
    leaderboard = ladder.get("leaderboard") or []
    matches = ladder.get("matches") or []
    place_by: dict[str, int] = {}
    for i, row in enumerate(leaderboard):
        place_by[nick_key(row.get("nick") or "")] = i + 1

    with psycopg2.connect(db) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO "RpMeta" (
                  scope, version, "updatedAt", "startRp", step, "radiant3Max",
                  "pMax", epoch, "historyOnly", slim, formula, "rawJson", "importedAt"
                ) VALUES (
                  %s::"RpScope", %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
                )
                ON CONFLICT (scope) DO UPDATE SET
                  version = EXCLUDED.version,
                  "updatedAt" = EXCLUDED."updatedAt",
                  "startRp" = EXCLUDED."startRp",
                  step = EXCLUDED.step,
                  "radiant3Max" = EXCLUDED."radiant3Max",
                  "pMax" = EXCLUDED."pMax",
                  epoch = EXCLUDED.epoch,
                  "historyOnly" = EXCLUDED."historyOnly",
                  slim = EXCLUDED.slim,
                  formula = EXCLUDED.formula,
                  "rawJson" = EXCLUDED."rawJson",
                  "importedAt" = EXCLUDED."importedAt"
                """,
                (
                    scope_u,
                    int(ladder.get("version") or 1),
                    _parse_dt(ladder.get("updatedAt")) or now,
                    float(ladder.get("startRp") or 1000),
                    int(ladder.get("step") or 150),
                    int(ladder.get("radiant3Max") or 4500),
                    float(ladder["pMax"]) if ladder.get("pMax") is not None else None,
                    ladder.get("epoch"),
                    bool(ladder.get("historyOnly")),
                    bool(ladder.get("slim", True)),
                    Json(ladder.get("formula")) if ladder.get("formula") is not None else None,
                    Json(
                        {
                            k: ladder.get(k)
                            for k in (
                                "weight",
                                "excludeSeed",
                                "leaderboardInfantry",
                                "leaderboardVehicle",
                                "formula",
                            )
                            if k in ladder
                        }
                    ),
                    now,
                ),
            )

            cur.execute(
                'DELETE FROM "RpLadderPlayer" WHERE scope = %s::"RpScope"',
                (scope_u,),
            )
            n_pl = 0
            for _k, p in players.items():
                nick = str(p.get("nick") or _k)
                nk = nick_key(nick)
                if not nk:
                    continue
                ms = p.get("matches") or []
                cur.execute(
                    """
                    INSERT INTO "RpLadderPlayer" (
                      id, scope, "nickKey", nick, rp, "rankLabel", "rankKey",
                      "predatorPlace", games, place, "matchesJson", "updatedAt"
                    ) VALUES (
                      %s, %s::"RpScope", %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
                    )
                    """,
                    (
                        _new_id(),
                        scope_u,
                        nk,
                        nick,
                        float(p.get("rp") or 0),
                        str(p.get("rankLabel") or ""),
                        str(p.get("rankKey") or ""),
                        p.get("predatorPlace"),
                        len(ms),
                        place_by.get(nk),
                        Json(ms),
                        now,
                    ),
                )
                n_pl += 1

            cur.execute(
                'DELETE FROM "RpScoredMatch" WHERE scope = %s::"RpScope"',
                (scope_u,),
            )
            n_m = 0
            for m in matches:
                mk = str(m.get("id") or "").strip()
                if not mk:
                    continue
                cur.execute(
                    """
                    INSERT INTO "RpScoredMatch" (
                      id, scope, "matchKey", date, "mapName", "rawJson", "updatedAt"
                    ) VALUES (%s, %s::"RpScope", %s, %s, %s, %s, %s)
                    """,
                    (
                        _new_id(),
                        scope_u,
                        mk,
                        m.get("date"),
                        m.get("map"),
                        Json(m),
                        now,
                    ),
                )
                n_m += 1
        conn.commit()
    return {"players": n_pl, "matches": n_m}


def _parse_dt(raw: Any) -> datetime | None:
    if not raw:
        return None
    try:
        s = str(raw).replace("Z", "+00:00")
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return None


def import_scope(scope: str, path: str | None = None) -> dict[str, int]:
    if not _enabled():
        return {"players": 0, "matches": 0, "skipped": 1}
    p = resolve_ladder_path(scope, path)
    if not p:
        print(f"rp_ladder_db: no ladder for {scope}", flush=True)
        return {"players": 0, "matches": 0}
    ladder = json.loads(p.read_text(encoding="utf-8"))
    stats = upsert_ladder(scope, ladder)
    print(
        f"rp_ladder_db {scope}: players={stats['players']} matches={stats['matches']} ← {p}",
        flush=True,
    )
    return stats


def sync_from_path(scope: str, path: Path | str) -> None:
    """Soft-fail hook for build_* scripts."""
    try:
        if not _enabled():
            return
        p = Path(path)
        if not p.is_file():
            return
        ladder = json.loads(p.read_text(encoding="utf-8"))
        stats = upsert_ladder(scope, ladder)
        print(
            f"rp_ladder_db sync {scope}: players={stats['players']} matches={stats['matches']}",
            flush=True,
        )
    except Exception as e:
        print(f"rp_ladder_db sync skip: {e}", flush=True)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--scope", choices=("TRAIN", "PUBLIC"))
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--path")
    args = ap.parse_args()
    if args.all:
        import_scope("TRAIN")
        import_scope("PUBLIC")
        return 0
    if not args.scope:
        ap.error("--scope or --all required")
    import_scope(args.scope, args.path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
