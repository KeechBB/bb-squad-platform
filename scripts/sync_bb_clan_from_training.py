# -*- coding: utf-8 -*-
"""Раньше добавлял в клан BB всех с тренировок. Запись отключена.

В состав только заявка или инвайт. Скрипт оставлен как сухой просмотр.

  python platform/scripts/sync_bb_clan_from_training.py
  python platform/scripts/sync_bb_clan_from_training.py --apply
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path

PLATFORM = Path(__file__).resolve().parents[1]
REPO = PLATFORM.parent


def resolve_kv_public() -> Path:
    env = (os.environ.get("KV_LOCAL_DIR") or "").strip()
    candidates = [
        Path(env) if env else None,
        PLATFORM / "data" / "kv-cache",
        REPO / "KV" / "public",
        PLATFORM / "KV" / "public",
    ]
    for p in candidates:
        if p and (
            (p / "data" / "training-index.json").is_file()
            or (p / "data" / "training" / "rp-ladder.json").is_file()
        ):
            return p
    raise SystemExit(
        "KV training data not found. Set KV_LOCAL_DIR or sync data/kv-cache."
    )


KV_PUBLIC = resolve_kv_public()


def nick_key(n: str) -> str:
    return re.sub(r"\s+", " ", (n or "").strip().lower())


def nick_compact(n: str) -> str:
    return re.sub(r"\s+", "", (n or "").strip().lower())


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


def collect_training_nicks() -> set[str]:
    nicks: set[str] = set()
    root = KV_PUBLIC

    lad_path = root / "data/training/rp-ladder.json"
    if lad_path.exists():
        lad = json.loads(lad_path.read_text(encoding="utf-8"))
        players = lad.get("players")
        if isinstance(players, dict):
            for p in players.values():
                if isinstance(p, dict) and p.get("nick"):
                    nicks.add(str(p["nick"]).strip())
        elif isinstance(players, list):
            for p in players:
                if isinstance(p, dict) and p.get("nick"):
                    nicks.add(str(p["nick"]).strip())
        for p in lad.get("leaderboard") or []:
            if isinstance(p, dict) and p.get("nick"):
                nicks.add(str(p["nick"]).strip())

    led_path = root / "data/training/rp-ledger.json"
    if led_path.exists():
        led = json.loads(led_path.read_text(encoding="utf-8"))
        for k, v in (led.get("players") or {}).items():
            if isinstance(v, dict) and v.get("nick"):
                nicks.add(str(v["nick"]).strip())
            else:
                nicks.add(str(k).strip())

    idx_path = root / "data/training-index.json"
    if idx_path.exists():
        idx = json.loads(idx_path.read_text(encoding="utf-8"))
        for m in idx.get("months") or []:
            url = m.get("url")
            if not url:
                continue
            month = json.loads((root / url).read_text(encoding="utf-8"))
            for match in month.get("matches") or []:
                purl = match.get("playersUrl")
                if not purl:
                    continue
                ppath = root / purl
                if not ppath.exists():
                    continue
                pj = json.loads(ppath.read_text(encoding="utf-8"))
                for key in ("r1", "r2", "total", "players"):
                    for row in pj.get(key) or []:
                        if row and row.get("nick"):
                            nicks.add(str(row["nick"]).strip())

    return {n for n in nicks if n}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()

    train_nicks = collect_training_nicks()
    print(f"Training nicks in stats: {len(train_nicks)}")

    keys = {nick_key(n) for n in train_nicks}
    comps = {nick_compact(n) for n in train_nicks}

    try:
        import psycopg2
    except ImportError as e:
        raise SystemExit(f"psycopg2 required: {e}") from e

    db = load_env_db()
    if not db:
        raise SystemExit("DATABASE_URL not set")

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

            cur.execute(
                """
                SELECT u.id, u.nick, u."steamName", cm."clanId", c.tag
                FROM "User" u
                LEFT JOIN "ClanMember" cm ON cm."userId" = u.id
                LEFT JOIN "Clan" c ON c.id = cm."clanId"
                WHERE u.nick IS NOT NULL OR u."steamName" IS NOT NULL
                """
            )

            to_add: list[tuple[str, str]] = []
            already_bb = 0
            other_clan = 0
            no_match = 0
            seen_users: set[str] = set()

            for user_id, nick, steam, mem_clan, tag in cur.fetchall():
                if user_id in seen_users:
                    # user may appear twice if multi-membership (shouldn't); skip
                    continue
                label = (nick or steam or "").strip()
                if not label:
                    continue
                k = nick_key(label)
                kc = nick_compact(label)
                if k not in keys and kc not in comps:
                    no_match += 1
                    continue
                seen_users.add(user_id)
                if mem_clan == clan_id:
                    already_bb += 1
                    continue
                if mem_clan:
                    other_clan += 1
                    print(f"  skip other clan [{tag}]: {label}")
                    continue
                to_add.append((user_id, label))

            print(f"Already in BB: {already_bb}")
            print(f"In other clan: {other_clan}")
            print(f"Registered unmatched to training: {no_match}")
            print(f"To add to BB: {len(to_add)}")
            for _, label in sorted(to_add, key=lambda x: x[1].lower()):
                print(f"  + {label}")

            if args.apply:
                print("Автодобавление в клан отключено. В состав только заявка или инвайт.")
            else:
                print("Dry-run. Запись в клан отключена.")
            conn.rollback()
    finally:
        conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
