#!/usr/bin/env python3
"""Upsert finished TRAIN/CW matches into CanonMatch (plaza Postgres).

Called from sync_train / sync_cw after JSON write. Soft-fail: never breaks sync.
Disable: BB_CANON_WRITE=0
"""

from __future__ import annotations

import json
import os
import re
import secrets
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent


def _enabled() -> bool:
    return os.environ.get("BB_CANON_WRITE", "1").strip() not in ("0", "false", "no")


def load_env_db() -> str:
    url = (os.environ.get("DATABASE_URL") or "").strip().strip('"').strip("'")
    if url:
        return url
    for p in (ROOT / ".env", HERE / ".squad-collector.env"):
        if not p.exists():
            continue
        for line in p.read_text(encoding="utf-8", errors="replace").splitlines():
            if line.startswith("DATABASE_URL="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    return ""


def _new_id() -> str:
    return "c" + secrets.token_hex(12)


def slug_map(name: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "", (name or "").lower())
    return s[:32] or "map"


def server_key_from_label(label: str | None) -> str:
    if not label:
        return "unk"
    u = str(label).upper()
    for key in ("TR1", "TR2", "TR3", "PB1", "PB2", "PB3"):
        if key in u or f"({key})" in u:
            return key.lower()
    if "TRAINING" in u or "ТРЕН" in u:
        return "tr"
    return "srv"


def parse_time_hm(t: str | None) -> str | None:
    if not t:
        return None
    m = re.match(r"^(\d{1,2}):(\d{2})", str(t).strip())
    if not m:
        return None
    return f"{int(m.group(1)):02d}:{m.group(2)}"


def make_match_key(
    year: int,
    month: int,
    day: int,
    server: str | None,
    map_name: str,
    time_msk: str | None,
    legacy_id: str | None = None,
    kind: str = "TRAIN",
) -> str:
    hm = (time_msk or "0000").replace(":", "")
    if len(hm) < 4:
        hm = hm.zfill(4)
    date = f"{year:04d}-{month:02d}-{day:02d}"
    base = f"{date}_{server_key_from_label(server)}_{slug_map(map_name)}_{hm[:4]}"
    if kind == "CW" and legacy_id:
        return f"{base}_{legacy_id}"
    return base


def _int(v: Any) -> int | None:
    if v is None or v == "":
        return None
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def _float(v: Any) -> float | None:
    if v is None or v == "":
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _players_from_train_doc(doc: dict[str, Any]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for side_key, side in (("teamA", "A"), ("teamB", "B")):
        for p in doc.get(side_key) or []:
            if not isinstance(p, dict):
                continue
            nick = str(p.get("nick") or "").strip()
            if not nick:
                continue
            key = f"{nick}\0{side}"
            if key in seen:
                continue
            seen.add(key)
            out.append(
                {
                    "side": side,
                    "round": 0,
                    "nick": nick,
                    "kills": int(p.get("kills") or 0),
                    "deaths": int(p.get("deaths") or 0),
                    "nok": int(p.get("nok") or 0),
                    "res": int(p.get("res") or 0),
                    "dmg": _float(p.get("dmg")),
                    "vehicleKills": _int(p.get("vehicleKills")),
                    "won": p.get("won") if isinstance(p.get("won"), bool) else None,
                    "rawJson": p,
                }
            )
    return out


def _players_from_cw_doc(doc: dict[str, Any]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for round_key, rnd, side in (
        ("r1", 1, "BB"),
        ("r2", 2, "BB"),
        ("oppR1", 1, "OPP"),
        ("oppR2", 2, "OPP"),
    ):
        for p in doc.get(round_key) or []:
            if not isinstance(p, dict):
                continue
            nick = str(p.get("nick") or "").strip()
            if not nick:
                continue
            key = f"{nick}\0{rnd}\0{side}"
            if key in seen:
                continue
            seen.add(key)
            out.append(
                {
                    "side": side,
                    "round": rnd,
                    "nick": nick,
                    "kills": int(p.get("kills") or 0),
                    "deaths": int(p.get("deaths") or 0),
                    "nok": int(p.get("nok") or 0),
                    "res": int(p.get("res") or 0),
                    "dmg": _float(p.get("dmg")),
                    "vehicleKills": _int(p.get("vehicleKills")),
                    "won": None,
                    "rawJson": {k: v for k, v in p.items() if k != "steamId"},
                }
            )
    return out


def _upsert(
    *,
    kind: str,
    source: str,
    match_key: str,
    legacy_id: str,
    year: int,
    month: int,
    day: int,
    time_msk: str | None,
    server_key: str | None,
    server_label: str | None,
    map_name: str,
    mode: str | None = None,
    size: str | None = None,
    faction_a: str | None = None,
    tickets_a: int | None = None,
    faction_b: str | None = None,
    tickets_b: int | None = None,
    winner: str | None = None,
    opp: str | None = None,
    stack: str | None = None,
    rules: str | None = None,
    meeting: str | None = None,
    r1: str | None = None,
    r2: str | None = None,
    status: str | None = None,
    note: str | None = None,
    legacy_players_path: str | None = None,
    raw_json: Any = None,
    players: list[dict[str, Any]] | None = None,
) -> str | None:
    if not _enabled():
        return None
    db = load_env_db()
    if not db:
        print("canon_match_write: no DATABASE_URL — skip", flush=True)
        return None
    try:
        import psycopg2
        from psycopg2.extras import Json
    except ImportError as e:
        print(f"canon_match_write: psycopg2 missing — skip ({e})", flush=True)
        return None

    now = datetime.now(timezone.utc)
    players = players or []
    conn = psycopg2.connect(db)
    conn.autocommit = False
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id FROM "CanonMatch"
                WHERE kind = %s::"CanonMatchKind"
                  AND year = %s AND month = %s AND "legacyId" = %s
                LIMIT 1
                """,
                (kind, year, month, legacy_id),
            )
            row = cur.fetchone()
            if not row:
                cur.execute(
                    'SELECT id FROM "CanonMatch" WHERE "matchKey" = %s LIMIT 1',
                    (match_key,),
                )
                row = cur.fetchone()

            fields = {
                "matchKey": match_key,
                "kind": kind,
                "source": source,
                "legacyId": legacy_id,
                "year": year,
                "month": month,
                "day": day,
                "timeMsk": time_msk,
                "serverKey": server_key,
                "serverLabel": server_label,
                "mapName": map_name,
                "mode": mode,
                "size": size,
                "factionA": faction_a,
                "ticketsA": tickets_a,
                "factionB": faction_b,
                "ticketsB": tickets_b,
                "winner": winner,
                "opp": opp,
                "stack": stack,
                "rules": rules,
                "meeting": meeting,
                "r1": r1,
                "r2": r2,
                "status": status,
                "note": note,
                "legacyPlayersPath": legacy_players_path,
                "rawJson": Json(raw_json) if raw_json is not None else None,
                "publishedAt": now,
                "updatedAt": now,
            }

            if row:
                match_id = row[0]
                cur.execute(
                    """
                    UPDATE "CanonMatch" SET
                      "matchKey"=%s, source=%s::"CanonMatchSource",
                      day=%s, "timeMsk"=%s, "serverKey"=%s, "serverLabel"=%s,
                      "mapName"=%s, mode=%s, size=%s,
                      "factionA"=%s, "ticketsA"=%s, "factionB"=%s, "ticketsB"=%s,
                      winner=%s, opp=%s, stack=%s, rules=%s, meeting=%s,
                      r1=%s, r2=%s, status=%s, note=%s,
                      "legacyPlayersPath"=%s, "rawJson"=%s,
                      "publishedAt"=%s, "updatedAt"=%s
                    WHERE id=%s
                    """,
                    (
                        fields["matchKey"],
                        source,
                        day,
                        time_msk,
                        server_key,
                        server_label,
                        map_name,
                        mode,
                        size,
                        faction_a,
                        tickets_a,
                        faction_b,
                        tickets_b,
                        winner,
                        opp,
                        stack,
                        rules,
                        meeting,
                        r1,
                        r2,
                        status,
                        note,
                        legacy_players_path,
                        fields["rawJson"],
                        now,
                        now,
                        match_id,
                    ),
                )
                cur.execute(
                    'DELETE FROM "CanonMatchPlayer" WHERE "matchId" = %s', (match_id,)
                )
            else:
                match_id = _new_id()
                cur.execute(
                    """
                    INSERT INTO "CanonMatch" (
                      id, "matchKey", kind, source, "legacyId",
                      year, month, day, "timeMsk", "serverKey", "serverLabel",
                      "mapName", mode, size,
                      "factionA", "ticketsA", "factionB", "ticketsB", winner,
                      opp, stack, rules, meeting, r1, r2, status, note,
                      "legacyPlayersPath", "rawJson", "publishedAt",
                      "createdAt", "updatedAt"
                    ) VALUES (
                      %s, %s, %s::"CanonMatchKind", %s::"CanonMatchSource", %s,
                      %s, %s, %s, %s, %s, %s,
                      %s, %s, %s,
                      %s, %s, %s, %s, %s,
                      %s, %s, %s, %s, %s, %s, %s, %s,
                      %s, %s, %s,
                      %s, %s
                    )
                    """,
                    (
                        match_id,
                        match_key,
                        kind,
                        source,
                        legacy_id,
                        year,
                        month,
                        day,
                        time_msk,
                        server_key,
                        server_label,
                        map_name,
                        mode,
                        size,
                        faction_a,
                        tickets_a,
                        faction_b,
                        tickets_b,
                        winner,
                        opp,
                        stack,
                        rules,
                        meeting,
                        r1,
                        r2,
                        status,
                        note,
                        legacy_players_path,
                        fields["rawJson"],
                        now,
                        now,
                        now,
                    ),
                )

            for p in players:
                cur.execute(
                    """
                    INSERT INTO "CanonMatchPlayer" (
                      id, "matchId", side, round, nick,
                      kills, deaths, nok, res, dmg, "vehicleKills", won, "rawJson"
                    ) VALUES (
                      %s, %s, %s, %s, %s,
                      %s, %s, %s, %s, %s, %s, %s, %s
                    )
                    ON CONFLICT ("matchId", nick, round, side) DO NOTHING
                    """,
                    (
                        _new_id(),
                        match_id,
                        p.get("side"),
                        p.get("round"),
                        p["nick"],
                        int(p.get("kills") or 0),
                        int(p.get("deaths") or 0),
                        int(p.get("nok") or 0),
                        int(p.get("res") or 0),
                        p.get("dmg"),
                        p.get("vehicleKills"),
                        p.get("won"),
                        Json(p.get("rawJson")) if p.get("rawJson") is not None else None,
                    ),
                )
        conn.commit()
        return match_id
    except Exception as e:
        conn.rollback()
        print(f"canon_match_write ERROR: {type(e).__name__}: {e}", file=sys.stderr, flush=True)
        return None
    finally:
        conn.close()


def upsert_train_row(
    month: str,
    row: dict[str, Any],
    *,
    players_path: Path | None = None,
    players_doc: dict[str, Any] | None = None,
    source: str = "LOG",
) -> str | None:
    """Upsert one TRAIN match from month row (+ optional players JSON)."""
    try:
        year, mo = map(int, month.split("-")[:2])
    except ValueError:
        return None
    legacy_id = str(row.get("id") or "").strip()
    if not legacy_id:
        return None
    day = int(row.get("day") or 0) or 1
    time_msk = parse_time_hm(row.get("timeMsk") or row.get("time"))
    map_name = str(row.get("map") or "unknown")
    srv = row.get("serverKey") or row.get("server")
    mk = make_match_key(year, mo, day, str(srv) if srv else None, map_name, time_msk)

    doc = players_doc
    if doc is None and players_path and players_path.is_file():
        try:
            doc = json.loads(players_path.read_text(encoding="utf-8"))
        except Exception:
            doc = None
    players = _players_from_train_doc(doc or {})
    sk = server_key_from_label(str(row.get("serverKey") or (doc or {}).get("serverKey") or srv))

    return _upsert(
        kind="TRAIN",
        source=source if source in ("LOG", "SCREENSHOT", "IMPORT_JSON") else "LOG",
        match_key=mk,
        legacy_id=legacy_id,
        year=year,
        month=mo,
        day=day,
        time_msk=time_msk,
        server_key=sk,
        server_label=str(row.get("server") or (doc or {}).get("server") or "") or None,
        map_name=map_name,
        mode=row.get("mode") or (doc or {}).get("mode"),
        size=row.get("size"),
        faction_a=row.get("factionA"),
        tickets_a=_int(row.get("ticketsA")),
        faction_b=row.get("factionB"),
        tickets_b=_int(row.get("ticketsB")),
        winner=row.get("winner") or (doc or {}).get("winner"),
        note=row.get("note") or (doc or {}).get("note"),
        status=row.get("status"),
        legacy_players_path=str(players_path.name) if players_path else None,
        raw_json=row,
        players=players,
    )


def upsert_cw_final(
    slot: dict[str, Any],
    players_doc: dict[str, Any],
    *,
    source: str = "LOG",
    require_finalize: bool | None = None,
) -> str | None:
    """Upsert CW into canon.

    LOG (collector): only when meeting finalized (both rounds) — default.
    SCREENSHOT: allow as soon as players JSON has roster (R1 and/or R2).
    """
    legacy_id = str(slot.get("id") or players_doc.get("matchId") or "").strip()
    if not legacy_id:
        return None
    src = source if source in ("LOG", "SCREENSHOT", "IMPORT_JSON") else "LOG"
    if require_finalize is None:
        require_finalize = src == "LOG"
    meeting = slot.get("meeting")
    status = str(slot.get("status") or "")
    finalized = bool(meeting) and status in ("win", "lose") and meeting not in (
        "—",
        "-",
        "",
    )
    if require_finalize and not finalized:
        return None
    year = int(slot.get("_year") or 0)
    month = int(slot.get("_month") or 0)
    if not year or not month:
        mk = str(slot.get("_monthKey") or "")
        try:
            year, month = map(int, mk.split("-")[:2])
        except ValueError:
            return None
    day = int(slot.get("day") or 0) or 1
    time_msk = parse_time_hm(slot.get("timeMsk") or slot.get("time"))
    map_name = str(
        slot.get("map") or players_doc.get("map") or "unknown"
    )
    srv = slot.get("server") or players_doc.get("server")
    match_key = make_match_key(
        year, month, day, str(srv) if srv else None, map_name, time_msk, legacy_id, "CW"
    )
    players = _players_from_cw_doc(players_doc)
    if src == "SCREENSHOT" and not players:
        return None
    return _upsert(
        kind="CW",
        source=src,
        match_key=match_key,
        legacy_id=legacy_id,
        year=year,
        month=month,
        day=day,
        time_msk=time_msk,
        server_key=server_key_from_label(str(srv) if srv else None),
        server_label=str(srv) if srv else None,
        map_name=map_name,
        size=slot.get("size"),
        opp=slot.get("opp") or players_doc.get("opp"),
        stack=slot.get("stack"),
        rules=slot.get("rules"),
        meeting=meeting if isinstance(meeting, str) else None,
        r1=slot.get("r1") if isinstance(slot.get("r1"), str) else None,
        r2=slot.get("r2") if isinstance(slot.get("r2"), str) else None,
        status=slot.get("status"),
        note=slot.get("note") or players_doc.get("note"),
        winner=None,
        legacy_players_path=f"players/{legacy_id}.json",
        raw_json={k: v for k, v in slot.items() if not str(k).startswith("_")},
        players=players,
    )


def publish_match_from_kv(
    *,
    root: Path,
    kind: str,
    legacy_id: str,
    month: str,
    source: str = "SCREENSHOT",
) -> str | None:
    """Load month row + players JSON from kv-cache data root → CanonMatch upsert.

    root = .../data/kv-cache/data  (has training/, players/, YYYY-MM.json)
    """
    kind_u = kind.upper().strip()
    legacy_id = legacy_id.strip()
    if kind_u == "TRAIN":
        month_path = root / "training" / f"{month}.json"
        players_path = root / "training" / "players" / f"{legacy_id}.json"
        if not month_path.is_file():
            print(f"missing month {month_path}", flush=True)
            return None
        data = json.loads(month_path.read_text(encoding="utf-8"))
        row = next(
            (m for m in (data.get("matches") or []) if str(m.get("id")) == legacy_id),
            None,
        )
        if not row:
            print(f"TRAIN id {legacy_id} not in {month_path.name}", flush=True)
            return None
        return upsert_train_row(
            month, row, players_path=players_path, source=source
        )

    if kind_u == "CW":
        month_path = root / f"{month}.json"
        players_path = root / "players" / f"{legacy_id}.json"
        if not month_path.is_file():
            print(f"missing month {month_path}", flush=True)
            return None
        data = json.loads(month_path.read_text(encoding="utf-8"))
        try:
            year, mo = map(int, month.split("-")[:2])
        except ValueError:
            return None
        row = next(
            (m for m in (data.get("matches") or []) if str(m.get("id")) == legacy_id),
            None,
        )
        if not row:
            print(f"CW id {legacy_id} not in {month_path.name}", flush=True)
            return None
        players_doc: dict[str, Any] = {}
        if players_path.is_file():
            try:
                players_doc = json.loads(players_path.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                players_doc = {}
        slot = {**row, "_year": year, "_month": mo, "_monthKey": month}
        return upsert_cw_final(
            slot,
            players_doc,
            source=source,
            require_finalize=False if source == "SCREENSHOT" else None,
        )

    print(f"unknown kind {kind}", flush=True)
    return None
