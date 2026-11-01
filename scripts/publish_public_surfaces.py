#!/usr/bin/env python3
"""Publish one public match to the DB ladder, profile rows, and rating cache.

The profile page only reads ProfileMatchLine. This module writes those rows
when a match is scored, so opening a profile does not rebuild history.
"""

from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import rp_log_parse as R

HERE = Path(__file__).resolve().parent
PLATFORM = HERE.parent
LADDER = PLATFORM / "data" / "public" / "rp-ladder.json"
CACHE = PLATFORM / "data" / "cache" / "public-rating-page.json"
GENERATION = PLATFORM / "data" / "cache" / "public-rating-generation"

_ID_RE = re.compile(r"^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})")


def js_round(n: float) -> int:
    return int(n + 0.5) if n >= 0 else int(n - 0.5)


def nick_key(n: str) -> str:
    return "".join(str(n or "").strip().lower().split())


def drop_rating_cache() -> None:
    """Next /public request rebuilds the match list. RP numbers already come from the DB."""
    GENERATION.parent.mkdir(parents=True, exist_ok=True)
    GENERATION.write_text(datetime.now(timezone.utc).isoformat(), encoding="utf-8")
    CACHE.unlink(missing_ok=True)
    print("public rating cache dropped", flush=True)


def _row_id(kind: str, key: str, match_id: str) -> str:
    raw = hashlib.md5(f"{kind}|{key}|{match_id}".encode("utf-8")).hexdigest()
    return raw[:25]


def _labels(match_id: str, date: str | None) -> tuple[str, str, str, str]:
    m = _ID_RE.match(str(match_id or ""))
    if m:
        y, mo, d, hh, mm = m.groups()
        played = f"{y}-{mo}-{d}"
        date_label = f"{d}.{mo}.{y}"
        time_label = f"{hh}:{mm}"
        return played, date_label, time_label, f"{played}T{time_label}-{match_id}"
    played = str(date or "")[:10] or "0000-00-00"
    if len(played) >= 10 and played[4] == "-":
        date_label = f"{played[8:10]}.{played[5:7]}.{played[0:4]}"
    else:
        date_label = played
    return played, date_label, "—", f"{played}T23:59-{match_id}"


def publish_match_rows(ladder: dict[str, Any], match_ids: set[str]) -> int:
    """Upsert profile rows for players of these matches. Returns rows written."""
    want = {str(x) for x in match_ids if x}
    if not want:
        return 0
    meta = {
        str(m.get("id")): m
        for m in (ladder.get("matches") or [])
        if isinstance(m, dict) and m.get("id")
    }
    players = ladder.get("players") or {}
    written: list[tuple] = []
    stamps: set[str] = set()
    for p in players.values():
        if not isinstance(p, dict):
            continue
        nick = str(p.get("nick") or "").strip()
        key = nick_key(nick)
        if not key:
            continue
        matches = [m for m in (p.get("matches") or []) if isinstance(m, dict) and m.get("id")]
        matches.sort(key=lambda m: str(m.get("id")))
        if not any(str(m.get("id")) in want for m in matches):
            continue
        try:
            official = js_round(float(p.get("rp") or 0))
        except (TypeError, ValueError):
            official = js_round(R.START_RP)
        running = float(R.START_RP)
        last_i = len(matches) - 1
        for i, m in enumerate(matches):
            try:
                net = float(m.get("net") or 0)
            except (TypeError, ValueError):
                net = 0.0
            running = float(js_round(running + net))
            mid = str(m.get("id"))
            if mid not in want:
                continue
            if i == last_i and abs(running - official) <= 5:
                running = float(official)
            info = meta.get(mid) or {}
            played, date_label, time_label, sort_key = _labels(mid, info.get("date") or m.get("date"))
            s1 = info.get("score1")
            s2 = info.get("score2")
            has_score = s1 is not None and s2 is not None
            tickets_a = int(s1) if has_score else None
            tickets_b = int(s2) if has_score else None
            score = f"{tickets_a}:{tickets_b}" if has_score else ""
            kills = int(m.get("kills") or 0) if not isinstance(m.get("kills"), list) else len(m.get("kills") or [])
            deaths = int(m.get("deaths") or 0) if not isinstance(m.get("deaths"), list) else len(m.get("deaths") or [])
            noks = m.get("noks")
            if isinstance(noks, list):
                nok = len(noks)
            else:
                nok = int(noks or 0)
            rev = m.get("revives")
            res = len(rev) if isinstance(rev, list) else int(rev or 0)
            rank = R.rp_rank(running)
            payload = {
                "matchId": mid,
                "dateLabel": date_label,
                "timeLabel": time_label,
                "map": str(info.get("map") or m.get("map") or "—"),
                "factionA": "—",
                "ticketsA": tickets_a,
                "factionB": "—",
                "ticketsB": tickets_b,
                "team": "—",
                "server": "PB1",
                "playersUrl": "",
                "won": m.get("won"),
                "res": res,
                "nok": nok,
                "kills": kills,
                "deaths": deaths,
                "rpAfter": int(running),
                "rpDelta": js_round(net),
                "pwrAfter": int(running),
                "pwrDelta": js_round(net),
                "rankLabel": rank.get("label") or p.get("rankLabel") or "",
                "rankKey": rank.get("rankKey") or p.get("rankKey") or "",
            }
            written.append(
                (
                    _row_id("public", key, mid),
                    key,
                    nick,
                    mid,
                    played,
                    time_label if time_label != "—" else "",
                    sort_key,
                    payload["map"],
                    score,
                    kills,
                    deaths,
                    res,
                    nok,
                    float(running),
                    float(js_round(net)),
                    json.dumps(payload, ensure_ascii=False),
                )
            )
            stamps.add(key)
    if not written:
        return 0
    _write_rows(written, stamps)
    print(f"profile rows published: {len(written)} players={len(stamps)}", flush=True)
    return len(written)


def _connect():
    import sys

    sys.path.insert(0, str(HERE))
    import canon_match_write as CANON  # noqa: WPS433

    db = CANON.load_env_db()
    if not db:
        raise RuntimeError("no database url")
    import psycopg2

    return psycopg2.connect(db)


def _write_rows(rows: list[tuple], stamps: set[str]) -> None:
    conn = _connect()
    try:
        with conn.cursor() as cur:
            keys = sorted({r[1] for r in rows})
            mids = sorted({r[3] for r in rows})
            cur.execute(
                """
                SELECT "nickKey", "matchId", score
                FROM "ProfileMatchLine"
                WHERE kind = 'public' AND "nickKey" = ANY(%s) AND "matchId" = ANY(%s)
                """,
                (keys, mids),
            )
            old_score = {(a, b): c or "" for a, b, c in cur.fetchall()}
            for row in rows:
                (
                    rid, key, nick, mid, played, time_label, sort_key, map_name,
                    score, kills, deaths, res, nok, rp_after, rp_delta, payload,
                ) = row
                prev = old_score.get((key, mid), "")
                keep_score = score == "" and prev != ""
                cur.execute(
                    """
                    INSERT INTO "ProfileMatchLine" (
                      id, kind, "nickKey", nick, "matchId", "playedOn", "timeLabel",
                      "sortKey", map, score, kills, deaths, res, nok,
                      "rpAfter", "rpDelta", payload, "updatedAt"
                    ) VALUES (
                      %s, 'public', %s, %s, %s, %s, %s,
                      %s, %s, %s, %s, %s, %s, %s,
                      %s, %s, %s::jsonb, NOW()
                    )
                    ON CONFLICT (kind, "nickKey", "matchId") DO UPDATE SET
                      nick = EXCLUDED.nick,
                      "playedOn" = EXCLUDED."playedOn",
                      "timeLabel" = EXCLUDED."timeLabel",
                      "sortKey" = EXCLUDED."sortKey",
                      map = EXCLUDED.map,
                      score = CASE WHEN %s THEN "ProfileMatchLine".score ELSE EXCLUDED.score END,
                      kills = EXCLUDED.kills,
                      deaths = EXCLUDED.deaths,
                      res = EXCLUDED.res,
                      nok = EXCLUDED.nok,
                      "rpAfter" = EXCLUDED."rpAfter",
                      "rpDelta" = EXCLUDED."rpDelta",
                      payload = CASE WHEN %s THEN "ProfileMatchLine".payload ELSE EXCLUDED.payload END,
                      "updatedAt" = NOW()
                    """,
                    (
                        rid, key, nick, mid, played, time_label, sort_key, map_name,
                        score, kills, deaths, res, nok, rp_after, rp_delta, payload,
                        keep_score, keep_score,
                    ),
                )
            for key in stamps:
                cur.execute(
                    """
                    INSERT INTO "ProfileMatchStamp" (id, kind, "nickKey", "builtAt")
                    VALUES (%s, 'public', %s, NOW())
                    ON CONFLICT (kind, "nickKey") DO UPDATE SET "builtAt" = NOW()
                    """,
                    (_row_id("stamp", key, "public"), key),
                )
        conn.commit()
    finally:
        conn.close()


def catch_up(path: Path | None = None) -> None:
    """File already has the match, but the DB or the profile row might not."""
    src = path or LADDER
    if not src.is_file():
        return
    import sys

    sys.path.insert(0, str(HERE))
    import rp_ladder_db as RPDB  # noqa: WPS433

    ladder = json.loads(src.read_text(encoding="utf-8"))
    synced = False
    try:
        meta_at = _meta_updated_at()
        file_at = src.stat().st_mtime
        if meta_at is None or file_at > meta_at + 30:
            RPDB.sync_required("PUBLIC", ladder)
            synced = True
    except Exception as e:
        print(f"RP catch-up DB sync failed: {e}", flush=True)
        raise
    ids = [str(m.get("id")) for m in (ladder.get("matches") or []) if isinstance(m, dict) and m.get("id")]
    if not ids:
        if synced:
            drop_rating_cache()
        return
    newest = sorted(ids)[-1]
    if _profile_count(newest) == 0:
        publish_match_rows(ladder, {newest})
        synced = True
    if synced:
        drop_rating_cache()


def _meta_updated_at() -> float | None:
    conn = _connect()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT EXTRACT(EPOCH FROM "updatedAt")
                FROM "RpMeta" WHERE scope = 'PUBLIC'
                """
            )
            row = cur.fetchone()
        return float(row[0]) if row and row[0] is not None else None
    finally:
        conn.close()


def _profile_count(match_id: str) -> int:
    conn = _connect()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT COUNT(*) FROM "ProfileMatchLine"
                WHERE kind = 'public' AND "matchId" = %s
                """,
                (match_id,),
            )
            row = cur.fetchone()
        return int(row[0] if row else 0)
    finally:
        conn.close()
