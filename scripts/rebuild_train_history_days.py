#!/usr/bin/env python3
"""Rebuild ProfileMatchLine (train) for nicks who played given days in training/YYYY-MM.json.

Usage on VPS:
  cd /var/www/bb-squad-platform
  python3 scripts/rebuild_train_history_days.py --days 29,30 --month 2026-10
"""
from __future__ import annotations

import argparse
import json
import os
import secrets
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TRAIN = Path(
    os.environ.get("BB_TRAIN_DIR")
    or str(ROOT / "data" / "kv-cache" / "data" / "training")
)
PLAYERS = TRAIN / "players"


def nick_key(n: str) -> str:
    return "".join(str(n or "").strip().lower().split())


def load_aliases() -> dict[str, str]:
    for cand in (
        TRAIN.parent / "tiers.json",
        Path("/var/www/blackberry-kv/public/data/tiers.json"),
    ):
        if not cand.is_file():
            continue
        try:
            t = json.loads(cand.read_text(encoding="utf-8"))
        except Exception:
            continue
        out: dict[str, str] = {}
        for raw, canon in (t.get("aliases") or {}).items():
            ak, ck = nick_key(str(raw)), nick_key(str(canon))
            if ak and ck:
                out[ak] = ck
        return out
    return {}


def resolve(n: str, aliases: dict[str, str]) -> str:
    k = nick_key(n)
    return nick_key(aliases.get(k, k))


def roster(doc: dict) -> list[dict]:
    if isinstance(doc.get("players"), list) and doc["players"]:
        return [r for r in doc["players"] if isinstance(r, dict)]
    return [
        r
        for r in list(doc.get("teamA") or []) + list(doc.get("teamB") or [])
        if isinstance(r, dict)
    ]


def faction_eq(a: str, b: str) -> bool:
    aa = "".join(str(a or "").lower().split())
    bb = "".join(str(b or "").lower().split())
    if not aa or not bb:
        return False
    if aa == bb:
        return True
    aliases = {
        "russiangroundforces": "rgf",
        "rgf": "rgf",
        "unitedstatesarmy": "usa",
        "usa": "usa",
        "usarmy": "usa",
        "russianairborneforces": "vdv",
        "vdv": "vdv",
        "middleeasterninsurgents": "ins",
        "insurgents": "ins",
        "ins": "ins",
        "australiandefenceforce": "adf",
        "adf": "adf",
        "britisharmedforces": "baf",
        "baf": "baf",
        "canadianarmedforces": "caf",
        "caf": "caf",
        "irregularmilitia": "im",
    }
    return aliases.get(aa, aa) == aliases.get(bb, bb)


def resolve_won(
    mine: list[dict], doc: dict, meta: dict
) -> tuple[str, bool | None]:
    if any(p.get("won") is True for p in mine):
        t = next((p.get("team") for p in mine if p.get("team")), "") or "—"
        return str(t).upper(), True
    if any(p.get("won") is False for p in mine):
        t = next((p.get("team") for p in mine if p.get("team")), "") or "—"
        return str(t).upper(), False

    winner = str(meta.get("winner") or doc.get("winner") or "").strip()
    fa = str(meta.get("factionA") or (doc.get("sideA") or {}).get("name") or "")
    fb = str(meta.get("factionB") or (doc.get("sideB") or {}).get("name") or "")
    team = ""
    for p in mine:
        if p.get("team"):
            team = str(p["team"])
            break
    on_a = any(
        faction_eq(str(p.get("team") or ""), fa)
        or str(p.get("squadSide") or "") == fa
        for p in mine
    )
    on_b = any(
        faction_eq(str(p.get("team") or ""), fb)
        or str(p.get("squadSide") or "") == fb
        for p in mine
    )
    if winner and (on_a or on_b or team):
        my = team or (fa if on_a else fb)
        if faction_eq(my, winner):
            return my.upper(), True
        return my.upper(), False

    ta = meta.get("ticketsA")
    tb = meta.get("ticketsB")
    if ta is None:
        ta = (doc.get("sideA") or {}).get("tickets")
    if tb is None:
        tb = (doc.get("sideB") or {}).get("tickets")
    try:
        ta_i, tb_i = int(ta), int(tb)
    except Exception:
        return (team or "—").upper(), None
    if on_a:
        return fa.upper() or "—", ta_i > tb_i
    if on_b:
        return fb.upper() or "—", tb_i > ta_i
    return (team or "—").upper(), None


def chrono_key(date_label: str, time_label: str, match_id: str) -> str:
    d = date_label.strip()
    parts = d.split(".")
    if len(parts) == 3:
        ymd = f"{parts[2]}-{parts[1]}-{parts[0]}"
    else:
        ymd = "0000-00-00"
    t = (time_label or "00:00").strip()
    if t in ("", "—", "-"):
        t = "00:00"
    return f"{ymd}T{t}-{match_id}"


def played_on(date_label: str) -> str:
    parts = date_label.strip().split(".")
    if len(parts) == 3:
        return f"{parts[2]}-{parts[1]}-{parts[0]}"
    return "0000-00-00"


def score_of(tickets_a, tickets_b, won) -> str:
    if tickets_a is None and tickets_b is None:
        return ""
    return f"{tickets_a if tickets_a is not None else '—'}:{tickets_b if tickets_b is not None else '—'}"


def db_connect():
    db = (os.environ.get("DATABASE_URL") or "").strip().strip("'").strip('"')
    if not db:
        for line in (ROOT / ".env").read_text(encoding="utf-8").splitlines():
            if line.startswith("DATABASE_URL="):
                db = line.split("=", 1)[1].strip().strip("'").strip('"')
                break
    import psycopg2

    return psycopg2.connect(db)


def build_rows_for_month(
    month: str, days: set[int]
) -> tuple[dict[str, list[dict]], dict[str, str]]:
    aliases = load_aliases()
    path = TRAIN / f"{month}.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    y, mo = month.split("-")
    year, month_n = int(y), int(mo)
    by_nick: dict[str, list[dict]] = {}
    display: dict[str, str] = {}

    for m in data.get("matches") or []:
        day = m.get("day")
        if day not in days:
            continue
        mid = str(m.get("id") or "")
        if not mid:
            continue
        pfile = PLAYERS / f"{mid}.json"
        if not pfile.is_file():
            print(f"missing players {mid}", flush=True)
            continue
        doc = json.loads(pfile.read_text(encoding="utf-8"))
        rows = roster(doc)
        tickets_a = m.get("ticketsA")
        tickets_b = m.get("ticketsB")
        if tickets_a is None:
            tickets_a = (doc.get("sideA") or {}).get("tickets")
        if tickets_b is None:
            tickets_b = (doc.get("sideB") or {}).get("tickets")
        try:
            tickets_a = int(tickets_a) if tickets_a is not None else None
        except Exception:
            tickets_a = None
        try:
            tickets_b = int(tickets_b) if tickets_b is not None else None
        except Exception:
            tickets_b = None
        faction_a = str(
            m.get("factionA") or (doc.get("sideA") or {}).get("name") or ""
        )
        faction_b = str(
            m.get("factionB") or (doc.get("sideB") or {}).get("name") or ""
        )
        winner = str(m.get("winner") or doc.get("winner") or "")
        date_label = f"{day:02d}.{month_n:02d}.{year}"
        time_label = str(m.get("timeMsk") or "—").strip() or "—"
        mapa = str(m.get("map") or doc.get("map") or "—")
        duration = m.get("duration") or doc.get("duration")
        server = m.get("server") or doc.get("server") or doc.get("serverKey")
        players_url = m.get("playersUrl") or f"data/training/players/{mid}.json"

        # group by resolved nick
        by_player: dict[str, list[dict]] = {}
        for r in rows:
            n = str(r.get("nick") or "").strip()
            if not n:
                continue
            k = resolve(n, aliases)
            display.setdefault(k, n)
            by_player.setdefault(k, []).append(r)

        for k, mine in by_player.items():
            team, won = resolve_won(
                mine,
                doc,
                {
                    "winner": winner,
                    "factionA": faction_a,
                    "factionB": faction_b,
                    "ticketsA": tickets_a,
                    "ticketsB": tickets_b,
                },
            )
            res = sum(int(p.get("res") or 0) for p in mine)
            nok = sum(int(p.get("nok") or 0) for p in mine)
            kills = sum(int(p.get("kills") or 0) for p in mine)
            deaths = sum(int(p.get("deaths") or 0) for p in mine)
            payload = {
                "matchId": mid,
                "dateLabel": date_label,
                "timeLabel": time_label,
                "map": mapa,
                "factionA": (faction_a or "—").upper(),
                "ticketsA": tickets_a,
                "factionB": (faction_b or "—").upper(),
                "ticketsB": tickets_b,
                "team": team,
                "winner": winner,
                "duration": duration,
                "server": server,
                "playersUrl": players_url,
                "won": won,
                "res": res,
                "nok": nok,
                "kills": kills,
                "deaths": deaths,
                "rpAfter": None,
                "rpDelta": None,
                "pwrAfter": 0,
                "pwrDelta": 0,
                "rankLabel": "—",
                "rankKey": "",
            }
            by_nick.setdefault(k, []).append(payload)

    return by_nick, display


def merge_full_history(
    conn, nick_key_s: str, nick_display: str, new_rows: list[dict], month: str, days: set[int]
) -> int:
    """Replace only 29/30 rows; keep other train lines."""
    cur = conn.cursor()
    # load existing payloads not on these days
    cur.execute(
        """
        select payload from "ProfileMatchLine"
        where kind='train' and "nickKey"=%s
        """,
        (nick_key_s,),
    )
    kept: list[dict] = []
    for (payload,) in cur.fetchall():
        if isinstance(payload, str):
            try:
                payload = json.loads(payload)
            except Exception:
                continue
        if not isinstance(payload, dict):
            continue
        mid = str(payload.get("matchId") or "")
        played = played_on(str(payload.get("dateLabel") or ""))
        drop = False
        if mid.startswith("29-") or mid.startswith("30-"):
            # only drop if month matches our rebuild window prefix days
            day_n = None
            try:
                day_n = int(mid.split("-", 1)[0])
            except Exception:
                day_n = None
            if day_n in days and played.startswith(month):
                drop = True
        if played in {f"{month}-{d:02d}" for d in days}:
            drop = True
        if not drop:
            kept.append(payload)

    # merge: kept + new, dedupe by matchId (new wins)
    by_id: dict[str, dict] = {}
    for r in kept + new_rows:
        mid = str(r.get("matchId") or "")
        if mid:
            by_id[mid] = r
    merged = list(by_id.values())

    cur.execute(
        'delete from "ProfileMatchLine" where kind=%s and "nickKey"=%s',
        ("train", nick_key_s),
    )
    now = datetime.now(timezone.utc)
    for r in merged:
        mid = str(r.get("matchId") or "")
        date_label = str(r.get("dateLabel") or "")
        time_label = str(r.get("timeLabel") or "—")
        row_id = f"pml_{secrets.token_hex(12)}"
        cur.execute(
            """
            insert into "ProfileMatchLine"
              (id, kind, "nickKey", nick, "matchId", "playedOn", "timeLabel", "sortKey",
               map, score, kills, deaths, res, nok, "rpAfter", "rpDelta", payload, "updatedAt")
            values (
              %s, 'train', %s, %s, %s, %s, %s, %s,
              %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s
            )
            """,
            (
                row_id,
                nick_key_s,
                nick_display,
                mid,
                played_on(date_label),
                time_label,
                chrono_key(date_label, time_label, mid),
                str(r.get("map") or ""),
                score_of(r.get("ticketsA"), r.get("ticketsB"), r.get("won")),
                int(r.get("kills") or 0),
                int(r.get("deaths") or 0),
                int(r.get("res") or 0),
                int(r.get("nok") or 0),
                r.get("rpAfter"),
                r.get("rpDelta"),
                json.dumps(r, ensure_ascii=False),
                now,
            ),
        )
    stamp_id = f"pms_{secrets.token_hex(12)}"
    cur.execute(
        """
        insert into "ProfileMatchStamp" (id, kind, "nickKey", "builtAt")
        values (%s, 'train', %s, %s)
        on conflict (kind, "nickKey") do update set "builtAt"=excluded."builtAt"
        """,
        (stamp_id, nick_key_s, now),
    )
    cur.close()
    return len(merged)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--month", default="2026-10")
    ap.add_argument("--days", default="29,30")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    days = {int(x) for x in str(args.days).split(",") if x.strip()}

    if not (TRAIN / f"{args.month}.json").is_file():
        print(f"missing {TRAIN / (args.month + '.json')}", flush=True)
        return 1

    by_nick, display = build_rows_for_month(args.month, days)
    print(f"nicks with 29/30 rows: {len(by_nick)}", flush=True)
    keech = by_nick.get("keech") or []
    print(
        f"keech rows on days: {len(keech)} ids={[r.get('matchId') for r in keech]}",
        flush=True,
    )
    if args.dry_run:
        return 0

    conn = db_connect()
    conn.autocommit = False
    try:
        # bump canon freshness if table has matching rows
        cur = conn.cursor()
        try:
            cur.execute(
                """
                update "CanonMatch"
                set "updatedAt"=now()
                where kind='TRAIN' and (
                  "legacyId" like '29-%%' or "legacyId" like '30-%%'
                  or "matchKey" ilike '2026-10-29%%'
                  or "matchKey" ilike '2026-10-30%%'
                )
                """
            )
            print(f"canon touch={cur.rowcount}", flush=True)
        except Exception as e:
            print(f"canon touch skip: {e}", flush=True)
            conn.rollback()
        cur.close()

        total = 0
        for k, rows in sorted(by_nick.items(), key=lambda x: x[0]):
            n = merge_full_history(conn, k, display.get(k, k), rows, args.month, days)
            total += 1
            if k == "keech" or total <= 3:
                print(f"  wrote {display.get(k,k)} lines_total={n} added_days={len(rows)}", flush=True)
        conn.commit()
        print(f"OK rebuilt {total} players", flush=True)
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
    return 0


if __name__ == "__main__":
    # fix return type of build_rows
    raise SystemExit(main())
