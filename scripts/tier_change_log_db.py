#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Пишет переводы тиров в Prisma TierChangeLog (+ ActionLog).

Автофит и бэкофилл → сюда. Ручная форма в админке → Next API recordTierChange.
Идемпотентность: unique (batchKey, nick). Для автофита:
  autofit:YYYY-MM-DD:<nick>:<from>-<to>
"""
from __future__ import annotations

import argparse
import json
import os
import re
import secrets
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse


def load_db_url() -> str:
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


def strip_prisma_params(url: str) -> str:
    if not url or "://" not in url or "?" not in url:
        return url
    parts = urlparse(url)
    q = [
        (k, v)
        for k, v in parse_qsl(parts.query, keep_blank_values=True)
        if k.lower() != "schema"
    ]
    return urlunparse(parts._replace(query=urlencode(q)))


def new_id() -> str:
    return "c" + secrets.token_hex(12)


def tier_label(t: int) -> str:
    if t == 1:
        return "Тир 1"
    if t == 2:
        return "Тир 2"
    if t == 3:
        return "Тир 3"
    return "Тир 4 / вне"


def format_tier_move(from_tier: int, to_tier: int) -> str:
    return f"{tier_label(from_tier)} → {tier_label(to_tier)}"


def autofit_batch_key(at_ymd: str, nick: str, from_tier: int, to_tier: int) -> str:
    safe = re.sub(r"[^a-zA-Z0-9._\-]+", "_", (nick or "").strip())[:48]
    day = (at_ymd or "")[:10]
    return f"autofit:{day}:{safe}:{int(from_tier)}-{int(to_tier)}"


def parse_changed_at(at: str | None) -> datetime:
    s = (at or "").strip()
    if not s:
        return datetime.now(timezone.utc)
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", s[:10]) and len(s) <= 10:
        y, m, d = (int(x) for x in s[:10].split("-"))
        return datetime(y, m, d, 12, 0, 0, tzinfo=timezone.utc)
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except ValueError:
        if len(s) >= 10 and re.fullmatch(r"\d{4}-\d{2}-\d{2}", s[:10]):
            y, m, d = (int(x) for x in s[:10].split("-"))
            return datetime(y, m, d, 12, 0, 0, tzinfo=timezone.utc)
        return datetime.now(timezone.utc)


def record_tier_changes(events: list[dict[str, Any]]) -> int:
    """
    Insert TierChangeLog (+ ActionLog). Returns newly inserted count.
    Event keys: nick, fromTier, toTier, at?, note?, actorNick?/actor?, batchKey?
    """
    if not events:
        return 0
    url = strip_prisma_params(load_db_url())
    if not url:
        print("tier_change_log_db: no DATABASE_URL — skip", flush=True)
        return 0
    try:
        import psycopg2
    except ImportError as e:
        print(f"tier_change_log_db: psycopg2 missing — skip ({e})", flush=True)
        return 0

    prepared: list[tuple] = []
    for ev in events:
        nick = str(ev.get("nick") or "").strip()
        if not nick:
            continue
        fr = int(ev.get("fromTier") or 0)
        to = int(ev.get("toTier") or 0)
        if fr == to or fr not in (1, 2, 3, 4) or to not in (1, 2, 3, 4):
            continue
        at = parse_changed_at(str(ev.get("at") or ""))
        day = at.astimezone(timezone.utc).strftime("%Y-%m-%d")
        batch = str(ev.get("batchKey") or "").strip() or autofit_batch_key(
            day, nick, fr, to
        )
        actor = (
            str(ev.get("actorNick") or ev.get("actor") or "автофит").strip() or "автофит"
        )
        note = str(ev.get("note") or "").strip() or None
        prepared.append((new_id(), at, nick, fr, to, note, batch, actor))

    if not prepared:
        return 0

    inserted = 0
    conn = psycopg2.connect(url)
    try:
        with conn:
            with conn.cursor() as cur:
                for tid, at, nick, fr, to, note, batch, actor in prepared:
                    cur.execute(
                        """
                        INSERT INTO "TierChangeLog"
                          (id, "changedAt", nick, "fromTier", "toTier", note,
                           "batchKey", "actorId", "actorNick", "createdAt")
                        VALUES (%s,%s,%s,%s,%s,%s,%s,NULL,%s,%s)
                        ON CONFLICT ("batchKey", nick) DO NOTHING
                        RETURNING id
                        """,
                        (tid, at, nick, fr, to, note, batch, actor, at),
                    )
                    if not cur.fetchone():
                        continue
                    inserted += 1
                    move = format_tier_move(fr, to)
                    msg = f"{actor}: {nick} {move}"
                    search = f"{msg} {nick} {actor}".lower()
                    meta = json.dumps(
                        {
                            "fromTier": fr,
                            "toTier": to,
                            "note": note,
                            "changedAt": at.isoformat(),
                            "batchKey": batch,
                            "source": "autofit",
                        },
                        ensure_ascii=False,
                    )
                    cur.execute(
                        """
                        INSERT INTO "ActionLog"
                          (id, "createdAt", category, action, message, "searchText",
                           "actorId", "actorNick", "targetNick", meta)
                        VALUES (%s,%s,'admin','tier_change',%s,%s,NULL,%s,%s,%s::jsonb)
                        """,
                        (new_id(), at, msg, search, actor, nick, meta),
                    )
    finally:
        conn.close()

    print(f"tier_change_log_db: inserted {inserted}/{len(prepared)}", flush=True)
    return inserted


def backfill_from_autofit_history(history_path: Path) -> int:
    if not history_path.is_file():
        print(f"no history file: {history_path}", flush=True)
        return 0
    data = json.loads(history_path.read_text(encoding="utf-8"))
    events = data.get("events") if isinstance(data, dict) else data
    if not isinstance(events, list):
        return 0
    payload = []
    for e in events:
        if not isinstance(e, dict):
            continue
        payload.append(
            {
                "nick": e.get("nick"),
                "fromTier": e.get("fromTier"),
                "toTier": e.get("toTier"),
                "at": e.get("at"),
                "note": e.get("note") or "Авто Fit",
                "actorNick": e.get("actor") or "автофит",
            }
        )
    return record_tier_changes(payload)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--backfill-history",
        type=Path,
        nargs="?",
        const=Path("/var/www/blackberry-kv/data/tier-autofit-history.json"),
        help="Backfill TierChangeLog from autofit history JSON",
    )
    args = ap.parse_args()
    if args.backfill_history is not None:
        n = backfill_from_autofit_history(args.backfill_history)
        print(f"backfill done: {n}")
    else:
        ap.print_help()


if __name__ == "__main__":
    main()
