#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Enqueue session backfill for users who registered but have 0 sessions.
Run on VPS after deploy (has DATABASE_URL to local Postgres).

  python3 scripts/enqueue_missing_session_backfills.py
"""
from __future__ import annotations

import os
import sys
import uuid
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

import psycopg2

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent


def load_env() -> None:
    for cand in (ROOT / ".env", HERE / ".squad-collector.env"):
        if not cand.exists():
            continue
        for line in cand.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def dsn() -> str:
    raw = os.environ["DATABASE_URL"].strip().strip('"').strip("'")
    u = urlparse(raw)
    q = [(k, v) for k, v in parse_qsl(u.query) if k.lower() != "schema"]
    host = u.hostname or ""
    if "localhost" not in host and "127.0.0.1" not in host:
        q.append(("sslmode", "require"))
    return urlunparse(u._replace(query=urlencode(q)))


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    load_env()
    conn = psycopg2.connect(dsn())
    cur = conn.cursor()
    cur.execute(
        """
        SELECT u.id, u.nick, u."steamId"
        FROM "User" u
        WHERE u."profileComplete" = true
          AND u."steamId" IS NOT NULL
          AND u."steamId" <> ''
          AND NOT EXISTS (
            SELECT 1 FROM "SquadServerSession" s WHERE s."userId" = u.id
          )
          AND NOT EXISTS (
            SELECT 1 FROM "SquadLogBackfillJob" j
            WHERE j."steamId" = u."steamId"
              AND j.status IN ('pending', 'running')
          )
        ORDER BY u."createdAt" DESC NULLS LAST
        LIMIT 50
        """
    )
    rows = cur.fetchall()
    print(f"enqueue candidates: {len(rows)}")
    for uid, nick, steam in rows:
        cur.execute(
            """
            INSERT INTO "SquadLogBackfillJob"
              (id, "userId", "steamId", nick, status, "createdAt")
            VALUES (%s, %s, %s, %s, 'pending', NOW())
            """,
            (str(uuid.uuid4()), uid, steam, nick),
        )
        print(f"  + {nick} {steam}")
    conn.commit()
    print("OK")


if __name__ == "__main__":
    main()
