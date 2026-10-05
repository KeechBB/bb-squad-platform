# -*- coding: utf-8 -*-
"""Пересобрать составы BB Main/Junior по частоте КВ.

Читает KV/public/data, пишет bb-stack-auto.json.
С --apply обновляет Neon/Postgres (DATABASE_URL) — только члены клана BB.

  python platform/scripts/sync_bb_squads_from_kv.py
  python platform/scripts/sync_bb_squads_from_kv.py --apply
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import uuid
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
KV_PUBLIC = ROOT / "KV" / "public"
OUT_JSON = KV_PUBLIC / "data" / "bb-stack-auto.json"

FORCE = {
    "keech": "Main",
    "chidori": "Main",
    "jimmy neutron": "Junior",
    "jimmy": "Junior",
    "vet": "Junior",
}
COMMAND = {
    "overallLead": "Keech",
    "Main": {"lead": "Keech", "assistant": "Chidori"},
    "Junior": {"lead": "Jimmy Neutron", "assistant": "VET"},
}


def nick_key(n: str) -> str:
    return re.sub(r"\s+", " ", (n or "").strip().lower())


def load_env_db() -> str:
    for p in (
        Path(__file__).resolve().parents[1] / ".env",
        Path(__file__).resolve().parents[1] / "scripts" / ".squad-collector.env",
    ):
        if not p.exists():
            continue
        for line in p.read_text(encoding="utf-8").splitlines():
            if line.startswith("DATABASE_URL="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    return (os.environ.get("DATABASE_URL") or "").strip().strip('"').strip("'")


def collect_nicks(pj: dict) -> set[str]:
    out: set[str] = set()
    for key in ("total", "players", "r1", "r2"):
        for p in pj.get(key) or []:
            if p and p.get("nick"):
                out.add(str(p["nick"]).strip())
    return out


def compute() -> dict:
    idx = json.loads((KV_PUBLIC / "data" / "index.json").read_text(encoding="utf-8"))
    counts: dict[str, dict] = defaultdict(lambda: {"nick": "", "Main": 0, "Junior": 0})
    last: dict[str, str] = {}
    matches = 0

    for mmeta in idx.get("months") or []:
        month = json.loads((KV_PUBLIC / mmeta["url"]).read_text(encoding="utf-8"))
        for m in month.get("matches") or []:
            st = str(m.get("status") or "").lower()
            stack = str(m.get("stack") or "").strip()
            if stack not in ("Main", "Junior") or st not in ("win", "lose"):
                continue
            purl = m.get("playersUrl")
            if not purl:
                continue
            ppath = KV_PUBLIC / purl
            if not ppath.exists():
                continue
            pj = json.loads(ppath.read_text(encoding="utf-8"))
            nicks = collect_nicks(pj)
            if not nicks:
                continue
            matches += 1
            for nick in nicks:
                k = nick_key(nick)
                counts[k]["nick"] = nick
                counts[k][stack] += 1
                last[k] = stack

    rows = []
    for k, c in counts.items():
        main, jun = c["Main"], c["Junior"]
        forced = FORCE.get(k)
        if forced:
            stack = forced
        elif main > jun:
            stack = "Main"
        elif jun > main:
            stack = "Junior"
        else:
            stack = last.get(k, "Main")
        rows.append(
            {
                "nick": c["nick"],
                "main": main,
                "junior": jun,
                "total": main + jun,
                "stack": stack,
            }
        )

    rows.sort(key=lambda r: (r["stack"], -r["total"], r["nick"].lower()))
    main = [r for r in rows if r["stack"] == "Main"]
    junior = [r for r in rows if r["stack"] == "Junior"]
    return {
        "updatedAt": datetime.now(timezone.utc).isoformat(),
        "matchesWithStats": matches,
        "command": COMMAND,
        "note": "stack = где чаще играл; ничья → последний матч; лиды закреплены",
        "main": main,
        "junior": junior,
        "all": rows,
    }


def apply_db(payload: dict) -> None:
    try:
        import psycopg2
        from psycopg2.extras import execute_values
    except ImportError as e:
        raise SystemExit(f"psycopg2 required for --apply: {e}") from e

    db = load_env_db()
    if not db:
        raise SystemExit("DATABASE_URL not set")

    prefer = {nick_key(r["nick"]): r["stack"] for r in payload["all"]}
    for alias, stack in FORCE.items():
        prefer.setdefault(alias, stack)

    conn = psycopg2.connect(db)
    conn.autocommit = False
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id FROM "Clan"
                WHERE lower(tag)=lower('BB') OR lower(name)=lower('BlackBerry')
                LIMIT 1
                """
            )
            row = cur.fetchone()
            if not row:
                raise SystemExit("BB clan not found")
            clan_id = row[0]

            for name, sort in (("Main", 0), ("Junior", 1)):
                cur.execute(
                    """
                    INSERT INTO "ClanSquad" (id, "clanId", name, "sortOrder", "createdAt")
                    SELECT %s, %s, %s, %s, NOW()
                    WHERE NOT EXISTS (
                      SELECT 1 FROM "ClanSquad"
                      WHERE "clanId"=%s AND lower(name)=lower(%s)
                    )
                    """,
                    (str(uuid.uuid4()), clan_id, name, sort, clan_id, name),
                )

            cur.execute(
                """
                SELECT id, name FROM "ClanSquad"
                WHERE "clanId"=%s AND lower(name) IN ('main','junior')
                """,
                (clan_id,),
            )
            squad_ids = {r[1].lower(): r[0] for r in cur.fetchall()}
            main_id, jun_id = squad_ids.get("main"), squad_ids.get("junior")
            if not main_id or not jun_id:
                raise SystemExit("Main/Junior squad missing")

            # drop custom squads
            cur.execute(
                """
                DELETE FROM "ClanSquad"
                WHERE "clanId"=%s AND lower(name) NOT IN ('main','junior')
                """,
                (clan_id,),
            )

            cur.execute(
                """
                SELECT cm."userId", u.nick, u."steamName"
                FROM "ClanMember" cm
                JOIN "User" u ON u.id = cm."userId"
                WHERE cm."clanId"=%s
                """,
                (clan_id,),
            )
            members = cur.fetchall()

            main_users = []
            jun_users = []
            for user_id, nick, steam in members:
                label = (nick or steam or "").strip()
                if not label:
                    continue
                k = nick_key(label)
                stack = prefer.get(k)
                if not stack:
                    continue
                # require at least 1 game unless forced leadership
                freq = next((r for r in payload["all"] if nick_key(r["nick"]) == k), None)
                if (not freq or freq["total"] <= 0) and k not in FORCE:
                    continue
                if stack == "Main":
                    main_users.append(user_id)
                else:
                    jun_users.append(user_id)

            cur.execute(
                'DELETE FROM "ClanSquadMember" WHERE "squadId" IN (%s, %s)',
                (main_id, jun_id),
            )
            now = datetime.now(timezone.utc)
            if main_users:
                execute_values(
                    cur,
                    'INSERT INTO "ClanSquadMember" (id, "squadId", "userId", "joinedAt") VALUES %s ON CONFLICT DO NOTHING',
                    [(str(uuid.uuid4()), main_id, uid, now) for uid in main_users],
                )
            if jun_users:
                execute_values(
                    cur,
                    'INSERT INTO "ClanSquadMember" (id, "squadId", "userId", "joinedAt") VALUES %s ON CONFLICT DO NOTHING',
                    [(str(uuid.uuid4()), jun_id, uid, now) for uid in jun_users],
                )
        conn.commit()
        print(f"DB applied: Main={len(main_users)} Junior={len(jun_users)}")
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="Write ClanSquadMember in DB")
    args = ap.parse_args()

    payload = compute()
    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {OUT_JSON}")
    print(f"matches={payload['matchesWithStats']} Main={len(payload['main'])} Junior={len(payload['junior'])}")
    if args.apply:
        apply_db(payload)
    return 0


if __name__ == "__main__":
    sys.exit(main())
